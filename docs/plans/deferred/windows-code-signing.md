# Windows code signing (deferred)

Status: deferred, waiting on the owner's decision, 2026-11-20. Nothing here is started. The decision is
[which identity signs and who pays](#the-owners-decision); the [order of work](#order-of-work-once-decided) starts
once it is made.

Facts about electron-builder below were read from `app-builder-lib` 26.18.1 (`node_modules/app-builder-lib/out`), the
version this repository installs. Facts about the signing services were read from their own pages on 2026-11-20 and
are cited where stated. Anything marked **unverified** was not confirmed against either and carries that date.

## What unsigned costs today

The Windows release is one NSIS installer, `apack-<version>-win-x64.exe`, built by `.github/workflows/build-windows.yml`
from the `win` target in `electron-builder.mjs`. Neither it nor anything inside it is signed.

- **SmartScreen stops every first run.** The user sees "Windows protected your PC" and has to choose "More info", then
  "Run anyway" (`docs/references/RELEASE.md`, Installing). The publisher reads "Unknown publisher".
- **The warning never wears off.** SmartScreen builds reputation per file hash and per publisher. An unsigned file has
  no publisher, so each release starts from zero
  ([SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
  page dated 2026-05-04).
- **Some machines cannot install it at all.** The same page says enterprise policy can remove "Run anyway", and that
  Windows 11's Smart App Control blocks unsigned executables that have no reputation, checking every executable file
  and not only downloaded ones.
- **Nothing tells a user the installer is ours.** A signature is the only check Windows itself makes that a download
  came from the publisher and was not altered.

Signing does not remove the first-run prompt at once. A signed file from a new publisher still shows "unrecognized
app", with the publisher's verified name, until the publisher's certificate has reputation. What signing changes is
that reputation carries from one release to the next.

## Options

| Option | Who can use it | Publisher shown | Rough cost | Fits a hosted CI runner |
|---|---|---|---|---|
| Azure Artifact Signing | organisations in listed countries; individuals in the United States or Canada | the validated legal name | USD 9.99 a month | yes, built into electron-builder |
| OV certificate, cloud HSM | anyone a certificate authority will validate | the validated legal name | roughly USD 220 to 440 a year, plus the signing service where separate | yes, through a custom sign function |
| OV or EV certificate, hardware token | the same | the validated legal name | the certificate, plus the token | no: the token must be plugged into the machine that signs |
| SignPath Foundation | open source projects it accepts | SignPath Foundation | free | yes, with a manual approval per release |
| Stay unsigned | anyone | Unknown publisher | nothing | n/a |

### Azure Artifact Signing

Microsoft's signing service, called Trusted Signing until its rename; the two names are one service
([pricing overview](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)). Microsoft holds the key and
issues short-lived certificates under one validated identity, so there is no certificate file to store or renew.

- **Eligibility.** Public Trust certificates are open to organisations in the United States, Canada, the European
  Union, the United Kingdom, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel.
  Individual developers must be in the United States or Canada
  ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), Prerequisites, page updated
  2026-11-17).
- **Individual validation** reads the legal name and address from the Azure billing account, which must be of type
  Individual and match a government-issued ID. The legal name, city, state and country appear on the certificate; the
  street address and email do not (same page).
- **Organisation validation** needs a legal entity, a business identifier, a website and email addresses on a domain
  the entity owns, and takes 1 to 30 business days (same page). **Unverified, 2026-11-20:** whether validation still
  expects a minimum age for the business. The quickstart states none.
- **Subscription.** A paid Azure subscription; free, trial and sponsored subscriptions are refused
  ([FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq), page dated 2026-11-17). Billing starts when the
  signing account is created and is not pro-rated.
- **Cost.** Basic is USD 9.99 a month for 5,000 signatures, one certificate profile of each type (Microsoft's
  SmartScreen page above gives the same starting price). A release signs a handful of files, so Basic is enough.
  **Unverified, 2026-11-20:** the pricing page showed no figures when fetched, so the Basic figure rests on the
  SmartScreen page and the overage and Premium prices are not stated here.
- **No EV.** The service issues no EV certificates and plans none (FAQ). That costs nothing: see the next section.

electron-builder supports it as `win.azureSignOptions` (`options/winOptions.d.ts`, `WindowsAzureSigningConfiguration`):
`publisherName`, `endpoint`, `certificateProfileName` and `codeSigningAccountName` are required; `fileDigest`,
`timestampRfc3161` and `timestampDigest` default to SHA256, `http://timestamp.acs.microsoft.com` and SHA256; any other
key is passed to the cmdlet as written. It installs the `TrustedSigning` PowerShell module (0.5.0 or later) from
PSGallery and runs `Invoke-TrustedSigning` once per file (`codeSign/windowsSignAzureManager.js`). Setting both
`azureSignOptions` and `signtoolOptions` signs with Azure and warns. Credentials are read by the cmdlet, not by
electron-builder: the type's documentation names Azure's `EnvironmentCredential`, which for a service principal is
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. The service principal needs the Artifact Signing
Certificate Profile Signer role (FAQ).

**Unverified, 2026-11-20:** that the `TrustedSigning` module and `Invoke-TrustedSigning` still sign after the rename,
and whether GitHub's OIDC federation (no stored secret) works through this path. Both are settled by the first
dispatch build.

### An OV or EV certificate

A certificate bought from a certificate authority, issued to a validated individual or organisation.

- **The key cannot be a file.** Since 2023-06-01 the CA/Browser Forum requires the private key of every code signing
  certificate to live on a FIPS-validated hardware token or HSM. `WIN_CSC_LINK` with a `.pfx` in a secret, the path
  electron-builder's documentation leads with, is not available for a newly issued certificate.
- **A hardware token** has to be plugged into the machine that signs, so a GitHub-hosted runner cannot use one. It
  means a self-hosted Windows runner or signing by hand.
- **A cloud HSM** keeps the key with the certificate authority or a cloud provider and signs through a tool:
  DigiCert KeyLocker, SSL.com eSigner, or a key in Azure Key Vault or Google Cloud KMS. This works from a hosted runner.
- **Validity.** A certificate issued on or after 2026-03-01 is valid for at most 460 days (CA/Browser Forum ballot
  CSC-31), so a multi-year purchase is reissued during its term.
- **Cost.** Reseller listings read on 2026-11-20 put OV at roughly USD 220 a year (Sectigo) to USD 440 a year
  (DigiCert). They are indicative: confirm with the vendor chosen. **Unverified, 2026-11-20:** EV prices, token
  prices, and what each vendor's cloud signing adds.
- **EV buys nothing here.** Microsoft: "EV certificates no longer bypass SmartScreen", and it advises against
  paying for EV to avoid the warning (SmartScreen page above). OV and EV build reputation the same way.

electron-builder reaches a cloud HSM through `win.signtoolOptions.sign`, a function or module path called for each file
in place of `signtool.exe` (`codeSign/windowsSignToolManager.js`, `signFile`). It runs with no certificate configured,
and once per entry in `signingHashAlgorithms`, which defaults to `['sha1', 'sha256']`: set `['sha256']` so each file is
signed once. The function runs the vendor's tool on `configuration.path`. `win.signtoolOptions.publisherName` is then
set by hand, since there is no certificate to read it from.

### SignPath Foundation

Free signing for open source projects, under a certificate issued to SignPath Foundation
([terms](https://signpath.org/terms), read 2026-11-20; the page carries no date).

- **The publisher shown is SignPath Foundation**, not apack or its owner.
- **Conditions**: an OSI-approved licence with no proprietary components (apack is MIT and public); an actively
  maintained project already released in the form to be signed; multi-factor authentication for every team member on
  SignPath and GitHub; a code signing policy on the project's home and download pages with the attribution line the
  terms give, naming SignPath.io and SignPath Foundation, the team's roles, and a privacy statement; an
  uninstaller; only binaries built from the project's own source are signed.
- **Every release is approved by hand** in SignPath, and the build must be verifiable from source.
- **It does not sign inside the build.** SignPath takes an uploaded artifact and returns it signed. The app's
  executables are inside the installer, so signing them means either a `signtoolOptions.sign` function that sends each
  file to SignPath during the build, or a SignPath artifact configuration that signs the files inside the installer.
  **Unverified, 2026-11-20:** whether SignPath can open an NSIS installer, and whether per-file requests each need
  their own approval.

### The Microsoft Store

Not evaluated. Microsoft re-signs Store apps and they never show a SmartScreen warning, but it is a second way of
shipping (an MSIX package, Store review, Store updates), not a way of signing the installer the release already has.

### Staying unsigned

Costs nothing and changes nothing: the costs are those in the first section, for every user and every release.

## What electron-builder signs, and what it leaves

Read from `winPackager.js`, `platformPackager.js` and `targets/nsis/NsisTarget.js`:

1. The app is packed, then the `afterPack` hook runs, then the Electron fuses are flipped, then `signApp` runs
   (`platformPackager.js`, `doPack`). Signing is therefore after `afterPack`: the third-party notices and SBOM that
   `electron-builder.mjs` writes there are in place before anything is signed, and nothing may change a binary later.
2. `signApp` edits and signs `<product>.exe`, and signs any other `.exe` at the top of the unpacked app.
3. It then walks `resources/app.asar.unpacked` for more, **only when the app is packed as an asar**. This app sets
   `asar: false`, so `signApp` returns before the walk and nothing under `resources/app` is signed.
4. The `afterSign` hook runs when `signApp` signed.
5. The NSIS target signs the uninstaller, then the installer.
6. `signExts` adds file endings to what counts as signable; by default only `.exe` does.

So with signing configured and nothing else changed, the installer, the uninstaller and `apack.exe` are signed, and
every native binary the app loads from `resources/app` is not: the terminal broker's `apack-terminal.exe` and
`OpenConsole.exe` (`packages/terminal-broker/src/pin.json`, `win32-x64`), elmdb's `.node` binding, and any other
`.exe`, `.dll` or `.node` under `node_modules`. Smart App Control checks each of those. The work below signs them from
an `afterSign` hook, through `context.packager.signIf(file)`, which signs any file it is handed with the configured
signer and queues the calls one at a time.

A failed or skipped signature does not fail a build by default: with no certificate configured electron-builder logs
"no code signing certificate configured, signing is skipped" and carries on. `forceCodeSigning: true` makes an
unsigned file an error (`winPackager.js`, `_sign`). The preview channel sets `signAndEditExecutable: false`, which
`forceCodeSigning` refuses, so the two are set on different channels.

## What each option needs

| | `electron-builder.mjs` | `build-windows.yml` secrets |
|---|---|---|
| Azure Artifact Signing | `win.azureSignOptions` with the four required fields, read from the environment so a build without them stays unsigned | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; the endpoint, account and profile names are not secret and can be repository variables |
| OV certificate, cloud HSM | `win.signtoolOptions` with `sign` (a module under `build/`), `signingHashAlgorithms: ['sha256']` and `publisherName` | whatever the vendor's tool authenticates with; a step that installs the tool |
| Hardware token | `win.signtoolOptions.certificateSubjectName` or `certificateSha1` | none; a self-hosted Windows runner holding the token |
| SignPath Foundation | a `sign` module that submits to SignPath, or nothing and a signing step after the build | `SIGNPATH_API_TOKEN`; the organisation and project identifiers |

Common to all of them:

- **`forceCodeSigning`** on for a build that is given signing credentials, so a signature that silently did not happen
  fails the build.
- **An `afterSign` hook** that signs the binaries under `resources/app` on Windows (previous section). A binary that
  already carries a valid signature from its own publisher is left alone.
- **`build-windows.yml`, mirroring `build-mac.yml`:**
  - *Signing secrets are configured*, on a tag only, before the build: every secret the chosen option takes is
    non-empty, or the job fails naming the empty ones.
  - *Build and package* exports the signing environment only when the secrets are set, so a dispatch from a branch
    still builds unsigned.
  - *Verify signing*, after the build, `continue-on-error` off a tag as on macOS. It runs
    `signtool verify /pa /v` on the installer, on `dist/win-unpacked/<product>.exe` and on each binary the `afterSign`
    hook signed; checks with `Get-AuthenticodeSignature` that the signer's subject is the expected publisher, so a
    signature from the wrong identity fails; and checks that each signature is timestamped, since an untimestamped
    one stops verifying when its certificate expires, which for Artifact Signing is days. On a tag a failure stops the
    job before the upload step, so an unsigned installer never reaches the release.
  - **Unverified, 2026-11-20:** where `signtool.exe` is on `windows-latest` (it ships with the Windows SDK and is not
    on `PATH` by default), and the exact flag that turns a missing timestamp into a failure.
- **`docs/references/RELEASE.md`**: the Windows line under Installing, the signing variables table and the CI section
  state the new behaviour.

## Recommendation

Azure Artifact Signing, if the owner or an entity the owner controls is eligible. It is the cheapest paid option, the
only one electron-builder supports without a custom signer, it runs on the hosted runner the release already uses,
there is no key or certificate to hold or renew, and the publisher shown is the owner's own name. Microsoft recommends
it for distribution outside the Store.

If no eligible identity exists (an individual outside the United States and Canada, with no organisation in a listed
country), SignPath Foundation: free, and apack meets the licence and repository conditions, at the price of showing
SignPath Foundation as publisher, a policy page, and an approval per release.

An OV certificate on a cloud HSM is the fallback when neither fits. It costs more each year and needs a custom signer
for no better SmartScreen result. An EV certificate and a hardware token are not recommended: EV adds cost without
effect, and a token takes the release off hosted runners.

Whichever signs, keep it: reputation belongs to the publisher identity, and changing identity starts it again.

## The owner's decision

1. **Which identity signs.** The owner as an individual (the legal name becomes the publisher Windows shows, with
   city, state and country in the certificate), an organisation the owner forms or already has, or SignPath
   Foundation. This decides which options are open: Artifact Signing's individual route exists only in the United
   States and Canada.
2. **Who pays, and from which account.** Artifact Signing needs a paid Azure subscription whose billing account
   matches the identity; a certificate is bought in the identity's name.
3. **Whether the first-run prompt on early signed releases is acceptable**, since no option removes it at once.

## Order of work once decided

1. Complete identity validation with the chosen service. This is the only step with a wait (up to 30 business days for
   an organisation on Artifact Signing) and the only one that cannot be done from this repository.
2. Add the secrets and variables to the repository.
3. `electron-builder.mjs`: the chosen option's `win` signing options, read from the environment; `forceCodeSigning`
   when they are present; the `afterSign` hook for `resources/app`.
4. `build-windows.yml`: the secrets check, the signing environment and the verify step.
5. Dispatch the workflow from a branch with the secrets set, and read the verify step's output: every binary listed,
   every signature valid, timestamped and from the expected publisher. This settles the items marked unverified for
   the chosen option.
6. Install that build on a Windows machine with Smart App Control on, and on the
   [Windows development VM](../../references/guides/windows-development-vm.md), and note what SmartScreen shows.
7. Update `docs/references/RELEASE.md`, then move this plan to the archive with the outcome.
8. Tag a beta. Its Windows build is the first release the gate holds to a signature.

## When to revisit

- The owner makes the decision above.
- A user reports that Windows will not let them install apack.
- Artifact Signing opens individual validation to more countries, if that is what rules it out today.
