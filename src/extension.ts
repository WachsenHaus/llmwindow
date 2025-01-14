// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import * as vscode from 'vscode';
import { mergeAllFiles } from './mergeCommand';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'llmwindow.mergeFiles',

    async () => {
      vscode.window.showInformationMessage('Merge Files command executed');
      await mergeAllFiles();
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
