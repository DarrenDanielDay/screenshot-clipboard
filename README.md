# screenshot-clipboard

Clipboard tooling for screenshots. Designed for attaching screenshot images to markdown blogs & static document website.

## Features

> This extension is also available in [Visual Studio for the Web](https://vscode.dev).

Commands:

- `Screenshot Clipboard: Open Webview`
- `Screenshot Clipboard: Pick Image`

You can open the command palette with `F1` or `Ctrl + Shift + P` (`⇧ + ⌘ + P` for MacOS).

### Paste Clipboard Screenshot Image

![paste.gif](./assets/paste.gif)

### Insert Image Link

![insert-link.gif](./assets/insert-link.gif)

## Requirements

None.

This extension requires no system clipboard tooling dependency. The core implementation depends on a standard webview API `navigator.clipboard.read()`.

## Extension Settings

name|description|type|default
-|-|-|-
screenshot-clipboard.configs.insertAbsolute|Whether to use absolute path when insert image link. When set to `true`, the workspace root folder is regarded as `/`.|boolean|false
screenshot-clipboard.configs.linkFormat|The format for image link insertion.|string|detect by file
screenshot-clipboard.configs.saveDir|A relative folder path to workspace folder for screenshot files.|string|assets


## Known Issues

Currently none.

## Release Notes

See [Changelog](./CHANGELOG.md).
