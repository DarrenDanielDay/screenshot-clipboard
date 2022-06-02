import { Button, colors, createTheme, FormGroup, TextField, ThemeProvider, Typography, useTheme } from "@mui/material";
import { Box } from "@mui/system";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import {
  catchError,
  combineLatest,
  EMPTY,
  filter,
  firstValueFrom,
  from,
  fromEvent,
  identity,
  map,
  mergeMap,
  mergeScan,
  noop,
  Observable,
  of,
  Subject,
  takeUntil,
} from "rxjs";
import { die } from "taio/build/utils/internal/exceptions";
import { defaultConfiguration, ExtensionMessage, useDestroy, WebviewMessage } from "./shared";
import hmacsha256 from "crypto-js/hmac-sha256";
// Only available in webview and can be only called once.
declare const acquireVsCodeApi:
  | (() => {
      postMessage(data: unknown): void;
    })
  | undefined;
type VSCodeAPI = ReturnType<NonNullable<typeof acquireVsCodeApi>>;
const vscodeApi =
  typeof acquireVsCodeApi === "undefined"
    ? identity<VSCodeAPI>({
        postMessage() {},
      })
    : acquireVsCodeApi();
const sendMessage = (message: WebviewMessage) => {
  vscodeApi.postMessage(message);
};

const readClipboardImage = async () => {
  const items = await (async () => {
    try {
      return await navigator.clipboard.read();
    } catch (error) {
      return die(/* TODO i18n */ `\
Failed to read clipboard. Please make sure you have allowed vscode to access clipboard \
and check whether the content format can be pasted into webview.`);
    }
  })();
  const item = items[0];
  if (!item) {
    return die(/* TODO i18n */ "No clipboard item found.");
  }
  const mimeType = item.types[0];
  if (!mimeType?.match(/^image\//)) {
    return die(/* TODO i18n */ `Unsupported MIME type: ${mimeType}`);
  }
  const blob = await item.getType(mimeType);
  const url = URL.createObjectURL(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chars = new Array<string>(bytes.length);
  bytes.forEach((byte, i) => (chars[i] = String.fromCharCode(byte)));
  const raw = chars.join("");
  const ext = mimeType.match(/\/([a-z]+)$/i)?.[1] ?? "png";
  const sha256 = hmacsha256(raw, __EXTENSION__).toString();
  const result = {
    mimeType,
    url,
    blob,
    raw,
    ext,
    hash: sha256,
  };
  return result;
};
type ImagePasteItem = Awaited<ReturnType<typeof readClipboardImage>>;
const ConfigurationContext = React.createContext(defaultConfiguration);
const ExtensionMessageContext = React.createContext({
  message$: identity<Observable<ExtensionMessage>>(new Subject()),
});
const useInputControl = (init: string) => {
  const [input, setInput] = React.useState(init);
  return {
    control: identity<Required<Pick<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">>>({
      value: input,
      onChange: React.useCallback((e) => {
        const input = e.target.value;
        React.startTransition(() => {
          setInput(input);
        });
      }, []),
    }),
    text: input,
  };
};
const PasteImage: React.FC = () => {
  // self maintained singleton service & elements
  const pasteImageService = React.useRef({
    readImageSignal$: new Subject<void>(),
    saveWith$: new Subject<string>(),
  });
  const nameRef = React.useRef<HTMLDivElement>(null);
  // outer provided context
  const theme = useTheme();
  const configuration = React.useContext(ConfigurationContext);
  // state
  const [pasteItem, setPasteItem] = React.useState<false | ImagePasteItem>(false);
  const saveNameControl = useInputControl("");
  // computed state with memo cache
  const inputSaveName = saveNameControl.text;
  const saveName = React.useMemo(
    () => pasteItem && `${inputSaveName || pasteItem.hash}.${pasteItem.ext}`,
    [inputSaveName, pasteItem]
  );
  const saveFullPath = React.useMemo(
    () => saveName && `${configuration.saveDir}/${saveName}`,
    [configuration, saveName]
  );
  // event handlers
  const handlePaste = React.useCallback(() => {
    pasteImageService.current.readImageSignal$.next();
    const input = nameRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, []);
  const handleSave = React.useCallback(saveName ? () => pasteImageService.current.saveWith$.next(saveName) : noop, [
    saveName,
  ]);
  const handleCleanBoard = React.useCallback(() => setPasteItem(false), []);
  // side effect hook
  React.useEffect(() => {
    const { destroy, destroy$ } = useDestroy();
    const { readImageSignal$, saveWith$ } = pasteImageService.current;
    const clipboardImage$ = readImageSignal$.pipe(
      takeUntil(destroy$),
      mergeMap(() =>
        from(readClipboardImage()).pipe(
          catchError((err) => {
            if (err instanceof Error) {
              sendMessage({
                type: "toast",
                data: {
                  type: "error",
                  message: err.message,
                },
              });
            }
            return EMPTY;
          })
        )
      )
    );
    clipboardImage$.subscribe(setPasteItem);
    const keydown$ = fromEvent(document, "keydown").pipe(
      mergeMap((e) => (e instanceof KeyboardEvent ? of(e) : EMPTY)),
      takeUntil(destroy$)
    );
    const pasteHotkey$ = keydown$.pipe(mergeMap((e) => (e.ctrlKey && e.key.toUpperCase() === "V" ? of(e) : EMPTY)));
    pasteHotkey$.subscribe(handlePaste);
    combineLatest([
      saveWith$,
      clipboardImage$.pipe(
        mergeMap((item) => {
          if (!item) {
            return EMPTY;
          }
          const base64 = window.btoa(item.raw);
          return of({
            base64,
            ...item,
          });
        })
      ),
    ])
      .pipe(takeUntil(destroy$))
      .subscribe(([name, { base64, mimeType }]) => {
        sendMessage({
          type: "save-image",
          data: {
            base64,
            mimeType,
            fileName: name,
          },
        });
      });
    return destroy;
  }, []);
  React.useEffect(
    () => () => {
      if (pasteItem) {
        URL.revokeObjectURL(pasteItem.url);
      }
    },
    [pasteItem]
  );
  // pure render fn logic with all inputs above
  const centerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  };
  const imageBlockStyle: React.CSSProperties = {
    width: theme.spacing(50),
    height: theme.spacing(50),
    border: `2px dashed ${colors.grey[500]}`,
    ...centerStyle,
  };
  return (
    <Box
      style={{
        ...centerStyle,
        flexDirection: "column",
      }}
    >
      {pasteItem ? (
        <img style={imageBlockStyle} src={pasteItem.url}></img>
      ) : (
        <Box style={imageBlockStyle} onClick={handlePaste}>
          {/* TODO i18n */ "Click to paste image here"}
        </Box>
      )}
      <Box style={centerStyle}>
        <TextField ref={nameRef} label={/* TODO i18n */ "save name"} variant="standard" {...saveNameControl.control} />
        <Button color="primary" type="submit" onClick={handleSave}>
          {/* TODO i18n */ "save"}
        </Button>
        <Button type="reset" color="error" onClick={handleCleanBoard}>
          {/* TODO i18n */ "clean"}
        </Button>
        <Button type="button" color="secondary" onClick={handlePaste}>
          {/* TODO i18n */ "paste"}
        </Button>
      </Box>
      {saveFullPath && (
        <Box>
          <Typography>{/* TODO i18n */ "Image will be saved as:"}</Typography>
          <Typography>{saveFullPath}</Typography>
        </Box>
      )}
    </Box>
  );
};
export const UI: React.FC = () => {
  return (
    <Box>
      <PasteImage />
    </Box>
  );
};

(function main() {
  if (typeof globalThis.document === "undefined") {
    return;
  }
  window.onload = async () => {
    const App: React.FC = await (async () => {
      const theme = createTheme();
      const message$ = fromEvent(window, "message").pipe(
        filter((e): e is MessageEvent => e instanceof MessageEvent),
        map((e): ExtensionMessage => e.data)
      );
      const configuration$ = message$.pipe(mergeMap((m) => (m.type === "configuration" ? of(m.data) : EMPTY)));
      sendMessage({ type: "fetch-all", data: void 0 });
      const initConfig = await firstValueFrom(configuration$);
      return () => {
        const messageContext = React.useRef({ message$ });
        const [configuration, setConfiguration] = React.useState(initConfig);
        React.useEffect(() => {
          const { destroy, destroy$ } = useDestroy();
          configuration$.pipe(takeUntil(destroy$)).subscribe(setConfiguration);
          return destroy;
        }, []);
        return (
          <React.StrictMode>
            <ExtensionMessageContext.Provider value={messageContext.current}>
              <ConfigurationContext.Provider value={configuration}>
                <ThemeProvider theme={theme}>
                  <UI></UI>
                </ThemeProvider>
              </ConfigurationContext.Provider>
            </ExtensionMessageContext.Provider>
          </React.StrictMode>
        );
      };
    })();
    const [root, isCSR] = (() => {
      const ssrRoot = document.querySelector("div#root");
      if (ssrRoot instanceof HTMLDivElement) {
        return [
          ReactDOM.hydrateRoot(ssrRoot, <App />, {
            onRecoverableError: (error) => {
              console.error(error);
              sendMessage({
                type: "toast",
                data: {
                  type: "error",
                  /* TODO i18n */
                  message: `Please report bug with following: ${
                    error instanceof Error ? `${error.message} ${error.stack}` : JSON.stringify(error)
                  }`,
                },
              });
            },
          }),
          false,
        ];
      }
      const newRoot = document.createElement("div");
      document.body.appendChild(newRoot);
      return [ReactDOM.createRoot(newRoot), true];
    })();
    if (isCSR) {
      root.render(<App />);
    }
  };
})();
