"""Offline guardrails for the staging runner; no AWS credentials or network."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("staging_smoke", HERE / "smoke-trace-capture-staging.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def stack_document():
    return {"Stacks": [{"StackName": smoke.STACK,
                       "StackId": f"arn:aws:cloudformation:us-east-1:000000000000:stack/{smoke.STACK}/synthetic-id",
                       "Parameters": [{"ParameterKey": "Environment", "ParameterValue": "membership-staging"},
                                      {"ParameterKey": "RequireMembership", "ParameterValue": "false"}],
                       "Outputs": [{"OutputKey": key, "OutputValue": value} for key, value in {
                           "ApiUrl": "https://synthetic1.execute-api.us-east-1.amazonaws.com",
                           "DevicesTable": smoke.STACK + "-TraceDevices-synthetic",
                           "MatchesTable": smoke.STACK + "-TraceMatches-synthetic",
                           "SharesTable": smoke.STACK + "-TraceShares-synthetic",
                           "PayloadBucket": smoke.STACK + "-tracepayloads-synthetic"}.items()]}]}


class StagingGuardTests(unittest.TestCase):
    def test_only_exact_staging_stack_and_outputs_are_allowed(self):
        smoke.validate_stack(stack_document(), "us-east-1", "disabled")
        mutations = [
            lambda row: row.update(StackName="trace-production"),
            lambda row: row.update(StackId=row["StackId"].replace("000000000000", "other-account")),
            lambda row: row["Parameters"][0].update(ParameterValue="production"),
            lambda row: row["Parameters"][1].update(ParameterValue="true"),
            lambda row: row["Outputs"][0].update(OutputValue="https://p5xbv2rfya.execute-api.us-east-1.amazonaws.com"),
            lambda row: row["Outputs"][0].update(OutputValue="https://victoryroad.app/trace"),
            lambda row: row["Outputs"][0].update(OutputValue="https://synthetic1.execute-api.us-east-1.amazonaws.com/redirect"),
            lambda row: row["Outputs"][0].update(OutputValue="https://synthetic1.execute-api.us-west-2.amazonaws.com"),
            lambda row: row["Outputs"][1].update(OutputValue="trace-production-TraceDevices-synthetic"),
            lambda row: row["Outputs"].pop(),
        ]
        for mutate in mutations:
            document = stack_document()
            mutate(document["Stacks"][0])
            with self.subTest(document=document), self.assertRaises(RuntimeError):
                smoke.validate_stack(document, "us-east-1", "disabled")

    def test_default_run_does_not_call_aws_or_http(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stack.json"
            path.write_text(json.dumps(stack_document()))
            with patch.object(sys, "argv", ["smoke", "--stack-description", str(path), "--enforcement", "disabled"]), \
                    patch.object(smoke.Smoke, "aws", side_effect=AssertionError("AWS forbidden")) as aws, \
                    patch.object(smoke.Smoke, "call", side_effect=AssertionError("HTTP forbidden")) as http, \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(smoke.main(), 0)
                aws.assert_not_called()
                http.assert_not_called()

    def test_cross_stack_physical_ownership_fails_before_registration(self):
        args = type("Args", (), {"region": "us-east-1", "enforcement": "disabled"})()
        runner = smoke.Smoke(args, stack_document())
        with patch.object(runner, "aws", side_effect=[stack_document(), {"StackResourceSummaries": []}]), \
                patch.object(runner, "call", side_effect=AssertionError("HTTP forbidden")) as http:
            with self.assertRaisesRegex(RuntimeError, "ownership mismatch"):
                runner.run()
            self.assertFalse(runner.register_attempted)
            http.assert_not_called()

    def test_fixture_exercises_current_private_and_public_projections(self):
        # Existing test module replaces boto3 with fakes before loading the app.
        fixture_path = HERE.parents[1] / "infrastructure/aws/tests/test_shared_replay.py"
        fixture_spec = importlib.util.spec_from_file_location("smoke_fixture_app", fixture_path)
        fixtures = importlib.util.module_from_spec(fixture_spec)
        fixture_spec.loader.exec_module(fixtures)
        payload = smoke.fixture("synthetic-match", smoke.dt.datetime.now(smoke.dt.timezone.utc))
        original = copy.deepcopy(payload)
        for public in (False, True):
            projected = fixtures.app.visible_review(payload["review"], public=public)
            smoke.assert_private_projection({"review": projected}, public)
        self.assertEqual(payload, original)
        with self.assertRaises(RuntimeError):
            smoke.assert_private_projection(payload)

    def test_http_does_not_follow_redirects(self):
        self.assertIsNone(smoke.NoRedirects().redirect_request(None, None, 302, "Found", {}, "https://victoryroad.app/trace"))


if __name__ == "__main__":
    unittest.main()
