import { Subject } from "rxjs";
import type { CreateTypeBySchemaType } from "taio/build/utils/json/interfaces/json-describer";
import { defineSchema } from "taio/build/utils/json/schema/schema-factory";
import { createValidatorBySchema } from "taio/build/utils/json/schema/validator-factory";

declare global {
  //#region Environment variables defined by `esbuild`
  var __DEV__: boolean;
  var __PLATFORM__: "desktop" | "browser";
  var __EXTENSION__: string;
  var __CONFIGURATION__: string;
  var __ROOT__: string;
  var __APP_BUNDLE__: string;
  //#endregion
}

type MessageOf<Map> = {
  [K in keyof Map]: {
    type: K;
    data: Map[K];
  };
}[keyof Map];
export enum ImageLinkFormat {
  Auto = "detect by file",
  Image = "image element",
  Markdown = "markdown",
}
const configSchema = defineSchema({
  type: "object",
  fields: {
    insertAbsolute: {
      type: "boolean",
    },
    linkFormat: {
      type: "enum",
      enumObject: ImageLinkFormat,
    },
    saveDir: {
      type: "string",
    },
  },
});

export type ExtensionConfiguration = CreateTypeBySchemaType<typeof configSchema>;
export const isConfiguration = createValidatorBySchema(configSchema);
export const defaultConfiguration: ExtensionConfiguration = {
  insertAbsolute: false,
  linkFormat: ImageLinkFormat.Auto,
  saveDir: "assets",
};
export enum ThemeType {
  Light = "light",
  Dark = "dark",
  HighContrast = "high-contrast",
  HighContrastLight = "high-contrast-light",
}

interface ExtensionMessages {
  configuration: ExtensionConfiguration;
  theme: ThemeType;
}

export type ExtensionMessage = MessageOf<ExtensionMessages>;

interface WebviewMessages {
  "fetch-all": void;
  "save-image": {
    base64: string;
    mimeType: string;
    fileName: string;
  };
  toast: {
    type: "info" | "warning" | "error";
    message: string;
  };
}

export type WebviewMessage = MessageOf<WebviewMessages>;

// Shared utils

export const useDestroy = () => {
  const destroy$ = new Subject<void>();
  return {
    destroy$,
    destroy: () => {
      destroy$.next();
      destroy$.complete();
    },
  };
};
