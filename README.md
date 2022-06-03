# screenshot-clipboard

Clipboard tooling for screenshots. Designed for attaching screenshot images to markdown blogs & static document website.

## Features

> This extension is available in [Visual Studio for the Web](https://vscode.dev).

### Paste Clipboard Screenshot Image



### Insert Image Link



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
