"""Pure archive/runner boundary checks; never execute a native fixture."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('claude_research_ci', Path(__file__).resolve().parents[2] / 'scripts/claude-research-ci.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class ReplayBoundary(unittest.TestCase):
    def fixture(self, root, name='src/probe.mjs', symlink=False):
        data = b'export const fixture = true;\n'
        bundle = root / 'runner.tgz'
        with tarfile.open(bundle, 'w:gz') as archive:
            member = tarfile.TarInfo(name)
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = '/outside'
                archive.addfile(member)
            else:
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        return bundle, {'archiveSha256': ci.digest(bundle), 'files': {name: hashlib.sha256(data).hexdigest()}}

    def test_exact_authored_file_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle, manifest = self.fixture(root)
            ci.unpack_tools(bundle, manifest, root / 'replay')
            self.assertEqual((root / 'replay/src/probe.mjs').read_text(), 'export const fixture = true;\n')

    def test_rejects_changed_source_even_when_archive_hash_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle, manifest = self.fixture(root)
            manifest['files']['src/probe.mjs'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'source hash changed'):
                ci.unpack_tools(bundle, manifest, root / 'replay')
            self.assertFalse((root / 'replay/src/probe.mjs').exists())

    def test_rejects_traversal_and_links(self):
        for name, symlink in [('../outside', False), ('/outside', False), ('src/link', True)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle, manifest = self.fixture(root, name, symlink)
                with self.assertRaisesRegex(ValueError, 'Unexpected research archive member'):
                    ci.unpack_tools(bundle, manifest, root / 'replay')

    def test_refuses_local_native_execution_before_network_or_launch(self):
        with patch.dict(ci.os.environ, {'GITHUB_ACTIONS': 'false'}), patch.object(ci, 'urlopen') as fetch, patch.object(ci.subprocess, 'run') as launch:
            for case in ci.CASES:
                with self.subTest(case=case), self.assertRaisesRegex(RuntimeError, 'disposable GitHub-hosted'):
                    ci.run(case)
            fetch.assert_not_called()
            launch.assert_not_called()

    def test_linux_route_requires_real_platform_architecture_and_container_marker(self):
        for system, arch, container in [('darwin', 'arm64', True), ('linux', 'x86_64', True), ('linux', 'aarch64', False)]:
            with self.subTest(system=system, arch=arch, container=container), patch.object(ci.sys, 'platform', system), patch.object(ci.platform, 'machine', return_value=arch), patch.object(ci.Path, 'is_file', return_value=container):
                with self.assertRaisesRegex(RuntimeError, 'Linux arm64 Docker container'):
                    ci.validate_host(True)
        with patch.object(ci.sys, 'platform', 'linux'), patch.object(ci.platform, 'machine', return_value='aarch64'), patch.object(ci.Path, 'is_file', return_value=True):
            self.assertEqual(ci.validate_host(True), 'linux-arm64')

    def test_linux_route_does_not_silently_adopt_other_profiles(self):
        with patch.object(ci, 'validate_host', return_value='linux-arm64'), patch.object(ci, 'urlopen') as fetch, patch.object(ci.subprocess, 'run') as launch:
            with self.assertRaisesRegex(ValueError, 'adoption currently covers'):
                ci.run('native-action-contexts', linux_container=True)
            fetch.assert_not_called()
            launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
