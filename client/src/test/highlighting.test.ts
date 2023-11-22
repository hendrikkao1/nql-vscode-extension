import * as vscode from "vscode";
import * as assert from "assert";
import { getDocUri, activate } from "./helper";

suite("Should do highlighting", () => {
  const docUri = getDocUri("highlighting.nql");

  test("Highlight NQL document", async () => {
    await testHighlighting(docUri);
  });
});

async function testHighlighting(docUri: vscode.Uri) {
  await activate(docUri);

  // TODO: How Can we test this?
  assert.ok(true);
}
