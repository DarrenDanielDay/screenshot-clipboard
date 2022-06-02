import {
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  mergeMap,
  of,
  ReplaySubject,
  Subject,
  switchMap,
  take,
  takeUntil,
} from "rxjs";
import { TypedObject } from "taio/build/libs/typescript/object";
import * as vscode from "vscode";
import { ExtensionMessage, ExtensionConfiguration, isConfiguration, WebviewMessage, useDestroy } from "./shared";
import * as ReactDomServer from "react-dom/server";
import * as React from "react";
import { UI } from "./app";

const useExtensionDestroy = (context: vscode.ExtensionContext) => {
  const { destroy, destroy$ } = useDestroy();
  context.subscriptions.push({
    dispose: destroy,
  });
  return destroy$;
};

const useConfiguration = () => {
  const configuration$ = new ReplaySubject<ExtensionConfiguration>(1);
  const notifyConfig = () => {
    const vscodeConfig = vscode.workspace.getConfiguration(__CONFIGURATION__);
    if (isConfiguration(vscodeConfig)) {
      configuration$.next(vscodeConfig);
    }
  };
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(__EXTENSION__)) {
      notifyConfig();
    }
  });
  notifyConfig();
  return configuration$;
};

const useCommand = (context: vscode.ExtensionContext, command: string, handler: () => void) => {
  const subscription = vscode.commands.registerCommand(command, handler);
  context.subscriptions.push(subscription);
};

const createSSRWebviewPanel = (context: vscode.ExtensionContext, app: React.ComponentType) => {
  const { destroy, destroy$ } = useDestroy();
  const webRoot = vscode.Uri.joinPath(context.extensionUri, __ROOT__);
  const panel = vscode.window.createWebviewPanel(
    "html",
    "Paste Image",
    {
      viewColumn: vscode.ViewColumn.Two,
    },
    {
      enableScripts: true,
      localResourceRoots: [webRoot],
    }
  );
  panel.onDidDispose(destroy);
  const { webview } = panel;
  webview.html = `<div id="root">${ReactDomServer.renderToString(React.createElement(app))}</div>\
<script src="${webview.asWebviewUri(vscode.Uri.joinPath(webRoot, "app.js"))}"></script>`;
  return { panel, destroy$ };
};

export function activate(context: vscode.ExtensionContext) {
  const shortCommands = {
    open: "open-webview",
    pickImage: "pick-image",
  } as const;
  const fullCommands = TypedObject.fromEntries(
    TypedObject.entries(shortCommands).map(([k, v]) => [k, `${__EXTENSION__}.${v}`] as const)
  );
  const extensionDestroy$ = useExtensionDestroy(context);
  const configuration$ = useConfiguration();
  const showWebview$ = new Subject<boolean>();
  const panel$ = showWebview$.pipe(
    distinctUntilChanged(),
    filter(Boolean),
    map(() => createSSRWebviewPanel(context, UI))
  );
  panel$.pipe(takeUntil(extensionDestroy$)).subscribe(({ destroy$, panel }) => {
    // event sources
    const webviewMessage$ = new Subject<WebviewMessage>();
    // functions
    const sendMessage = (message: ExtensionMessage) => {
      panel.webview.postMessage(message);
    };

    //#region  event handlers
    // configuration
    combineLatest([configuration$, webviewMessage$.pipe(filter((m) => m.type === "fetch-all"))])
      .pipe(takeUntil(destroy$))
      .subscribe(([configuration]) => {
        sendMessage({
          type: "configuration",
          data: configuration,
        });
      });
    // save image
    webviewMessage$
      .pipe(
        mergeMap((m) => (m.type === "save-image" ? of(m.data) : EMPTY)),
        switchMap((message) =>
          configuration$.pipe(
            take(1),
            map((config) => ({ config, message }))
          )
        ),
        takeUntil(destroy$)
      )
      .subscribe(async ({ config, message: { base64, fileName } }) => {
        const possibleWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri;
        const saveDir = possibleWorkspace
          ? vscode.Uri.joinPath(possibleWorkspace, config.saveDir)
          : await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectMany: false,
              canSelectFolders: true,
              // TODO: i18n
              title: "select a folder to save",
            });
        if (!(saveDir instanceof vscode.Uri)) {
          return;
        }
        const bytes = Buffer.from(base64, "base64");
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(saveDir, fileName), bytes);
      });
    // toast
    webviewMessage$
      .pipe(
        mergeMap((m) => (m.type === "toast" ? of(m.data) : EMPTY)),
        takeUntil(destroy$)
      )
      .subscribe(({ type, message }) => {
        switch (type) {
          case "error":
            vscode.window.showErrorMessage(message);
            break;
          case "warning":
            vscode.window.showWarningMessage(message);
          default:
            vscode.window.showInformationMessage(message);
            break;
        }
      });
    //#endregion
    //#region connect to webview
    panel.webview.onDidReceiveMessage((e) => {
      // no type check
      webviewMessage$.next(e);
    });
    panel.onDidDispose(() => {
      showWebview$.next(false);
    });
    //#endregion
  });

  useCommand(context, fullCommands.open, () => showWebview$.next(true));
}

export function deactivate() {}
