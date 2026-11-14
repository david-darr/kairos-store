"""Pin compatibility: do not hide more tools while repairing review recovery."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'items/tab/psa_command'))
import mcp_bridge


class PSACommandDiscoveryTests(unittest.TestCase):
    def listing(self,psa=True):
        args=['--taskbar-url','https://example.test/api']
        keys='tbk_'+'b'*64
        if psa:
            args += ['--psa-url','https://psa-sales-backend.onrender.com/api/agent/v1']
            keys += ' psak_'+'a'*64
        return mcp_bridge.tool_list(mcp_bridge.connections_from(args,keys))

    def pins(self):
        return {t['name']:hashlib.sha256(json.dumps({k:t[k] for k in ('name','description','inputSchema')},sort_keys=True,separators=(',',':')).encode()).hexdigest() for t in self.listing()}

    def test_patch_preserves_all_previously_published_tool_pins(self):
        previous=json.loads((ROOT/'tests/fixtures/psa-command-1.5.0-pins.json').read_text())
        self.assertEqual(self.pins(),previous)

    def test_workspace_upgrade_reproduces_chris_partial_tool_list(self):
        previous=json.loads((ROOT/'tests/fixtures/psa-command-1.4.3-pins.json').read_text())
        visible={name for name,digest in self.pins().items() if previous.get(name)==digest}
        self.assertEqual(visible,{'sales_overview','taskbar_tasks','taskbar_task','taskbar_members','taskbar_programs','taskbar_create_task','taskbar_update_task','taskbar_connection'})
        self.assertTrue({'psa_team','psa_schools','psa_enrollments','psa_cancel_enrollment'} <= self.pins().keys())

    def test_taskbar_only_configuration_is_distinct_from_held_psa_tools(self):
        self.assertFalse(any(t['name'].startswith('psa_') for t in self.listing(psa=False)))
        self.assertTrue(any(t['name']=='psa_schools' for t in self.listing()))

    def test_listing_does_not_call_the_network_or_test_key_scopes(self):
        from unittest.mock import patch
        with patch.object(mcp_bridge.catalog,'urllib_transport',side_effect=AssertionError('No network during discovery')):
            self.assertIn('psa_team',{t['name'] for t in self.listing()})
