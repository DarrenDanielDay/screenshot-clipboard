import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  mergeMap,
  Observable,
  of,
  OperatorFunction,
  ReplaySubject,
  Subject,
  switchMap,
  take,
  takeUntil,
} from "rxjs";
import { TypedObject } from "taio/build/libs/typescript/object";
import * as vscode from "vscode";
import {
  ExtensionMessage,
  ExtensionConfiguration,
  isConfiguration,
  WebviewMessage,
  useDestroy,
  ImageLinkFormat,
} from "./shared";
import { die } from "taio/build/utils/internal/exceptions";
import path from "path";
const appBundle = __APP_BUNDLE__ ? __APP_BUNDLE__ : void 0;
const useExtensionDestroy = (context: vscode.ExtensionContext) => {
  const { destroy, destroy$ } = useDestroy();
  context.subscriptions.push({
    dispose: destroy,
  });
  return destroy$;
};

const useConfiguration = (context: vscode.ExtensionContext): Observable<ExtensionConfiguration> => {
  const configuration$ = new ReplaySubject<ExtensionConfiguration>(1);
  const notifyConfig = () => {
    const vscodeConfig = vscode.workspace.getConfiguration(__CONFIGURATION__);
    if (isConfiguration(vscodeConfig)) {
      configuration$.next(vscodeConfig);
    }
  };
  const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(__EXTENSION__)) {
      notifyConfig();
    }
  });
  context.subscriptions.push(disposable);
  notifyConfig();
  return configuration$;
};

const useLastActiveTextEditor = (context: vscode.ExtensionContext): Observable<vscode.TextEditor> => {
  const activeEditor$ = new ReplaySubject<vscode.TextEditor>(1);
  const disposable = vscode.window.onDidChangeActiveTextEditor((e) => {
    if (e) {
      activeEditor$.next(e);
    }
  });
  const currentActiveEditor = vscode.window.activeTextEditor;
  if (currentActiveEditor) {
    activeEditor$.next(currentActiveEditor);
  }
  context.subscriptions.push(disposable);
  return activeEditor$;
};

const useCommand = (context: vscode.ExtensionContext, command: string, handler: () => void) => {
  const subscription = vscode.commands.registerCommand(command, handler);
  context.subscriptions.push(subscription);
};

const createCSRWebviewPanel = (context: vscode.ExtensionContext) => {
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
  webview.html = `\
${
  appBundle
    ? `<script>${appBundle}</script>`
    : `<script src="${webview.asWebviewUri(vscode.Uri.joinPath(webRoot, "app.js"))}"></script>`
}`;
  return { panel, destroy$ };
};

const generalErrorHandle = <T extends unknown>(): OperatorFunction<T, T> => {
  return catchError((e) => {
    if (e instanceof Error && e.message) {
      vscode.window.showErrorMessage(e.message);
    }
    return EMPTY;
  });
};

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel(__EXTENSION__);
  const browserDebug = (msg: string, err?: unknown) => {
    if (__PLATFORM__ === "browser") {
      output.appendLine(msg);
      if (err instanceof Error) {
        output.appendLine(err.message);
        output.appendLine(err.stack ?? "(no stack info)");
      }
    }
  };
  const possibleWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  const shortCommands = {
    open: "open-webview",
    pickImage: "pick-image",
  } as const;
  const fullCommands = TypedObject.fromEntries(
    TypedObject.entries(shortCommands).map(([k, v]) => [k, `${__EXTENSION__}.${v}`] as const)
  );
  const extensionDestroy$ = useExtensionDestroy(context);
  const configuration$ = useConfiguration(context);
  const editor$ = useLastActiveTextEditor(context);
  //#region webview
  const showWebview$ = new Subject<boolean>();
  const panel$ = showWebview$.pipe(
    distinctUntilChanged(),
    filter(Boolean),
    map(() => createCSRWebviewPanel(context))
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
        browserDebug("config updated");
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
        browserDebug(`save with workspace: ${possibleWorkspace?.toString() ?? "no wokrspace folder"}`);
        browserDebug(JSON.stringify(config));
        const saveDir = await (async () => {
          try {
            return possibleWorkspace
              ? vscode.Uri.joinPath(possibleWorkspace, config.saveDir)
              : await vscode.window.showOpenDialog({
                  canSelectFiles: false,
                  canSelectMany: false,
                  canSelectFolders: true,
                  // TODO: i18n
                  title: "select a folder to save",
                });
          } catch (error) {
            browserDebug(`failed to get saveDir`, error);
            return undefined;
          }
        })();
        if (!(saveDir instanceof vscode.Uri)) {
          return;
        }
        const bytes = Buffer.from(base64, "base64");
        try {
          const targetUri = vscode.Uri.joinPath(saveDir, fileName);
          browserDebug(`Trying to use file system in browser: uri = ${targetUri.toString()}`);
          await vscode.workspace.fs.writeFile(targetUri, bytes);
        } catch (error) {
          browserDebug(`Failed to write`, error);
        }
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
  type ImageLinkCtx = {
    src: string;
    name: string;
  };

  //#endregion

  //#region pick image
  const getImage = (ctx: ImageLinkCtx) => new vscode.SnippetString(`<img src="${ctx.src}" alt=${ctx.name} />$0`);
  const getMarkdown = (ctx: ImageLinkCtx) => new vscode.SnippetString(`![${ctx.name}](${ctx.src})`);
  const normalizeUrlFriendlyRelativePath = (p: string) => {
    const slashReplaced = p.replace(/\\/g, "/");
    const alwaysRelative = slashReplaced.match(/\.\.?\//) ? slashReplaced : `./${slashReplaced}`;
    return alwaysRelative;
  };
  const insert$ = new Subject<void>();
  const insertEditor$ = insert$.pipe(switchMap(() => editor$.pipe(take(1))));
  insertEditor$
    .pipe(
      switchMap((editor) =>
        configuration$.pipe(
          take(1),
          map((config) => ({ config, editor })),
          switchMap(async (ctx) => {
            if (!possibleWorkspace) {
              return die(/* TODO i18n */ "Please open a folder/workspace first.");
            }
            const imageDir = vscode.Uri.joinPath(possibleWorkspace, ctx.config.saveDir);
            const childList = await vscode.workspace.fs.readDirectory(imageDir);
            const files = childList.flatMap(([name, type]) => (type === vscode.FileType.File ? [name] : []));
            if (!files.length) {
              return die(/* TODO i18n */ "No file found.");
            }
            const result = await vscode.window.showQuickPick(files, {
              title: /* TODO i18n */ "Select a file to insert",
              canPickMany: false,
            });
            if (!result) {
              return die();
            }
            const imageFile = vscode.Uri.joinPath(imageDir, result);
            return {
              ...ctx,
              imageFile,
              workspaceUri: possibleWorkspace,
            };
          }),
          generalErrorHandle()
        )
      ),
      takeUntil(extensionDestroy$)
    )
    .subscribe(({ config: { insertAbsolute, linkFormat }, editor, workspaceUri, imageFile }) => {
      const docPath = editor.document.uri.path;
      const { ext: docExt, dir: docFolderPath } = path.parse(docPath);
      const imgPath = imageFile.path;
      const { base: imgFileName } = path.parse(imgPath);
      const src = insertAbsolute
        ? normalizeUrlFriendlyRelativePath(path.relative(workspaceUri.path, imgPath)).slice(1)
        : normalizeUrlFriendlyRelativePath(path.relative(docFolderPath, imgPath));
      const snippet = (() => {
        const ctx: ImageLinkCtx = {
          src,
          name: imgFileName,
        };
        switch (linkFormat) {
          case ImageLinkFormat.Image:
            return getImage(ctx);
          case ImageLinkFormat.Markdown:
            return getMarkdown(ctx);
          default:
            switch (docExt) {
              case ".html":
                return getImage(ctx);
              case ".md":
              case ".markdown":
                return getMarkdown(ctx);
              default:
                return new vscode.SnippetString(src);
            }
        }
      })();
      editor.insertSnippet(snippet);
    });
  //#endregion

  useCommand(context, fullCommands.open, () => showWebview$.next(true));
  useCommand(context, fullCommands.pickImage, () => insert$.next());
}

export function deactivate() {}
