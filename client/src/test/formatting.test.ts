import * as vscode from "vscode";
import * as assert from "assert";
import { getDocUri, activate } from "./helper";

suite("Should do formatting", () => {
  const docUri = getDocUri("formatting.nql");

  test("Formates NQL file", async () => {
    await testFormatting(docUri);
  });
});

async function testFormatting(
  docUri: vscode.Uri,
) {
  await activate(docUri);

  // Executing the command `vscode.executeCompletionItemProvider` to simulate formatting action 
  const textEdits = (await vscode.commands.executeCommand(
    "vscode.executeFormatDocumentProvider",
    docUri,
    {
      tabSize: 2,
      insertSpaces: true,

    }
  )) as vscode.TextEdit[];

  // TODO: How Can we test this?
  assert.ok(true);
}
