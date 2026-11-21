// @slow: two programs and six language-service queries, over two `apack pack build`s and two packed tarballs
// The **published package** half of `facade-typing.integration.spec.ts`: the same questions asked of a pack
// that resolves @apackdev from the registry rather than from workspace source, which is the layout every pack
// author actually has. `installPublishedPackages()` packs @apackdev/sdk and /ui and installs them into
// the fixture, and is not memoised — which is why the suite is split by layout and not by subject, since a
// subject split would pay for that twice. Skipped whole when the packages are not built.
import { facadeSuite } from '../_support/facade-packs';

facadeSuite('published package', true);
