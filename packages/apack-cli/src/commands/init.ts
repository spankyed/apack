import type { PackManifest } from '@apackdev/sdk/build';
import { writeManifest } from '../manifest-writer.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderTemplate } from '../templates.ts';
import { toPascalCase } from './add/write';
import * as readline from 'node:readline';
import semver from 'semver';
import { resolveDeps } from './generate';
import { generateEntries } from './generate-entries';
import { cliVersion, readManifest, sdkVersion } from '../utils';

const MANIFEST_TEMPLATE = (name: string): PackManifest => {
  const pascalName = name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return {
    $schema: './node_modules/@apackdev/sdk/apack.schema.json',
    id: name,
    name: name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    version: '0.1.0',
    hostVersion: '>=0.3.0',
    data: { entities: { [pascalName]: {} }, relations: {} },
    features: {},
    dependencies: {},
    permissions: [],
    content: {
      sources: {
        actions: 'src/content/actions',
        flows: 'src/content/flows',
        // Entities of the pack's own type, from markdown, with the format below: no code needed
        [EXAMPLE_CONTENT_KEY]: { path: `src/content/${EXAMPLE_CONTENT_KEY}`, format: EXAMPLE_CONTENT_KEY },
      },
      formats: {
        [EXAMPLE_CONTENT_KEY]: {
          format: 'markdown-tree',
          entity: pascalName,
          identity: ['title'],
          fields: {
            title: { from: 'frontmatter.title', default: 'filename', type: 'string' },
            content: { from: 'body' },
          },
        },
      },
    },
  };
};

/** The scaffold's example content key */
const EXAMPLE_CONTENT_KEY = 'examples';

const EXAMPLE_CONTENT_TEMPLATE = `---
title: Hello
---
Written from src/content/${EXAMPLE_CONTENT_KEY}/hello.md by the "${EXAMPLE_CONTENT_KEY}" content source and format in apack.json.
`;

/**
 * The tsconfig `apack pack init` scaffolds, as an object so the test packs can build on it. A test pack that
 * compiles a narrower file set than a real one hides whole classes of bug: a dangling import in generated
 * code stayed invisible for exactly that reason.
 */
export const PACK_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    types: ['node'],
    // A pack typechecks the @apackdev packages' published declarations, which is what apack pack build
    // compiles it against. Their declarations name .ts files.
    allowImportingTsExtensions: true,
    // Mirrors package.json "imports": TypeScript doesn't add extensions to subpath import targets
    paths: {
      '#generated/*': ['./src/__generated__/*'],
    },
  },
  include: ['src/**/*.ts', 'tests/**/*.ts'],
};

const TSCONFIG_TEMPLATE = JSON.stringify(PACK_TSCONFIG, null, 2);


const PACKAGE_JSON_TEMPLATE = (name: string) => JSON.stringify({
  name: `@apack-pack/${name}`,
  version: '0.1.0',
  private: true,
  type: 'module',
  imports: {
    '#generated/*': './src/__generated__/*',
  },
  scripts: {
    prepare: 'apack pack generate-entries',
    build: 'apack pack build',
    validate: 'apack pack validate',
    dev: 'apack pack dev',
    test: 'vitest run',
    typecheck: 'tsc --noEmit',
    // The facade dependents compile against, recorded for review. Either half bundles the facade itself, so
    // neither needs a build; `etc/pack-types.api.md` appears at the first `facade:update` rather than at init
    'facade:check': 'apack pack facade-report',
    'facade:update': 'apack pack facade-report --update',
  },
  dependencies: {
    // The generated facades import the EARS engine; it's released with the SDK at the same version
    '@apackdev/ears': SDK_RANGE(),
    '@apackdev/sdk': SDK_RANGE(),
    zod: '^3.25.76',
  },
  devDependencies: {
    // Pinned per project: a global, Homebrew or app-bundled `apack` hands off to this one
    '@apackdev/cli': `^${cliVersion()}`,
    // Unit tests run the pack's content and repositories in memory (@apackdev/testing/harness)
    ...UNIT_TEST_DEV_DEPENDENCIES(SDK_RANGE()),
    // The scaffold's tsconfig uses Node types
    '@types/node': '^22.15.17',
    typescript: '^5.8.3',
  },
}, null, 2);



// One of the four templates that cannot be a file under `templates/` (`src/templates.ts` has the list):
// electron-builder strips every `.d.ts` from the packaged app whatever its `files` array says — measured, zero
// remain in app.asar — so a `.d.ts` template would be missing from the CLI the app installs.
const ENV_DTS_TEMPLATE = `// Plain \`tsc\` can't read .vue files, so the pack's own single-file components resolve to a
// generic component here. @apackdev/ui components ship declarations and keep their prop types.
// Checking inside SFCs needs vue-tsc.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}
`;

/** The @apackdev/sdk range the scaffold declares: the SDK this CLI runs against */
const SDK_RANGE = () => `^${sdkVersion() ?? cliVersion()}`;

/** The first vitest release the harness runs on (its peer range) */
const VITEST_FLOOR = '3.0.0';

/**
 * What the unit test setup needs installed, for a pack on `sdkRange`. @apackdev/testing is released with @apackdev/sdk at
 * the same version and takes it as a peer dependency (^<version>, one minor before 1.0), so it gets the pack's SDK range.
 */
const UNIT_TEST_DEV_DEPENDENCIES = (sdkRange: string) => ({ '@apackdev/testing': sdkRange, vitest: '^3.2.1' });

/** The files vitest loads its config from, in the order it looks for them */
export const VITEST_CONFIG_FILES = ['vitest.config', 'vite.config'].flatMap((name) => ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `${name}.${ext}`));

export interface UnitTestSetup {
  /** Files written */
  created: string[];
  /** The config vitest already loaded in the pack (vitest.config.* or vite.config.*), kept: it may not load tests/setup.ts */
  keptConfig?: string;
  /** devDependencies added to package.json */
  addedDependencies: string[];
  /** Packages the pack already has that the harness can't run on, with the range to upgrade to and why */
  upgrades: Array<{ name: string; range: string; reason: string }>;
}

/** The pack's @apackdev/sdk range, as npm resolves @apackdev/testing's peer against it */
function packSdkRange(pkg: PackageJson): string {
  const declared = pkg.dependencies?.['@apackdev/sdk'] ?? pkg.devDependencies?.['@apackdev/sdk'] ?? pkg.peerDependencies?.['@apackdev/sdk'];
  return declared && semver.validRange(declared) ? declared : SDK_RANGE();
}

interface PackageJson {
  version?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** A package installed where the pack's Node resolution finds it (node_modules at or above the pack) */
function installedPackage(root: string, name: string): PackageJson | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Why the pack's own `name` (declared as `declared`, installed or not) can't run the harness, if it can't */
function outdatedReason(root: string, name: string, declared: string, wanted: string): string | undefined {
  const installed = installedPackage(root, name);
  if (name === '@apackdev/testing') {
    if (installed && !installed.exports?.['./harness']) return `the installed ${installed.version ?? 'version'} has no @apackdev/testing/harness`;
    if (semver.validRange(declared) && !semver.intersects(declared, wanted)) return `${declared} doesn't match the pack's @apackdev/sdk ${wanted}`;
  } else {
    if (installed?.version && semver.valid(installed.version) && semver.lt(installed.version, VITEST_FLOOR)) return `the installed ${installed.version} is before ${VITEST_FLOOR}`;
    if (semver.validRange(declared) && !semver.intersects(declared, `>=${VITEST_FLOOR}`)) return `${declared} is before ${VITEST_FLOOR}`;
  }
  return undefined;
}

/**
 * Writes the unit test setup a pack lacks: vitest.config.ts, tests/setup.ts (the harness) and their devDependencies.
 * Keeps files that exist, and reports dependencies the pack has that the harness can't run on.
 */
export function scaffoldUnitTestSetup(root: string): UnitTestSetup {
  const created: string[] = [];
  const keptConfig = VITEST_CONFIG_FILES.find((file) => fs.existsSync(path.join(root, file)));
  if (!keptConfig) {
    const configPath = path.join(root, 'vitest.config.ts');
    fs.writeFileSync(configPath, renderTemplate('pack/vitest.config.ts'));
    created.push(configPath);
  }
  const setupPath = path.join(root, 'tests', 'setup.ts');
  if (!fs.existsSync(setupPath)) {
    fs.mkdirSync(path.dirname(setupPath), { recursive: true });
    fs.writeFileSync(setupPath, renderTemplate('pack/tests/setup.ts'));
    created.push(setupPath);
  }
  const addedDependencies: string[] = [];
  const upgrades: UnitTestSetup['upgrades'] = [];
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;
    const sdkRange = packSdkRange(pkg);
    for (const [name, range] of Object.entries(UNIT_TEST_DEV_DEPENDENCIES(sdkRange))) {
      const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      if (declared) {
        const reason = outdatedReason(root, name, declared, sdkRange);
        if (reason) upgrades.push({ name, range, reason });
        continue;
      }
      pkg.devDependencies = { ...pkg.devDependencies, [name]: range };
      addedDependencies.push(name);
    }
    if (addedDependencies.length > 0) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  return { created, keptConfig, addedDependencies, upgrades };
}


const GITIGNORE_TEMPLATE = `node_modules/
dist/
.apack/
src/__generated__/
*.tgz
`;

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export async function init(args: string[]) {
  const name = args[0] || await prompt('Pack name', 'my-pack');

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error('Pack name must be lowercase alphanumeric with hyphens (e.g. "my-pack")');
  }

  const dir = path.resolve(name);
  if (fs.existsSync(dir)) {
    throw new Error(`Directory "${name}" already exists`);
  }

  fs.mkdirSync(path.join(dir, 'src', 'content', 'actions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'content', 'flows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'content', EXAMPLE_CONTENT_KEY), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  writeManifest(dir, MANIFEST_TEMPLATE(name));
  fs.writeFileSync(path.join(dir, 'src', 'content', EXAMPLE_CONTENT_KEY, 'hello.md'), EXAMPLE_CONTENT_TEMPLATE);
  fs.writeFileSync(path.join(dir, 'package.json'), PACKAGE_JSON_TEMPLATE(name));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), TSCONFIG_TEMPLATE);
  fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE_TEMPLATE);
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'release.yml'), renderTemplate('pack/github/workflows/release.yml'));
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), renderTemplate('pack/github/workflows/ci.yml'));
  // What `init` prints below scrolls away; this is what the author reads in six months
  fs.writeFileSync(path.join(dir, 'README.md'), renderTemplate('pack/README.md', { NAME: name }));
  fs.writeFileSync(path.join(dir, 'src', 'env.d.ts'), ENV_DTS_TEMPLATE);
  scaffoldUnitTestSetup(dir);
  fs.writeFileSync(
    path.join(dir, 'tests', `${name}.spec.ts`),
    renderTemplate('pack/tests/example.spec.ts', { NAME: name, CONTENT_KEY: EXAMPLE_CONTENT_KEY, PASCAL: toPascalCase(name) }),
  );

  const initManifest = readManifest(dir);
  const dependencies = await resolveDeps(dir, initManifest.dependencies);
  await generateEntries([], dir, dependencies);

  console.log(`\nCreated pack "${name}" at ./${name}/`);
  console.log(`\nImport types in your content code:`);
  console.log(`  import type { ActionMeta } from '@apackdev/sdk/build';`);
  console.log(`  import type { Services, Z } from '#generated/services.ts';`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  apack pack add feature <name> --description "What the feature does"`);
  console.log(`  apack pack build`);
  console.log(`  npm run facade:update   # records the types dependents compile against; commit it`);
  console.log(`\nREADME.md has the rest.`);
}
