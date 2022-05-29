import { Subject } from "rxjs";
import { CreateTypeBySchemaType } from "taio/build/utils/json/interfaces/json-describer";
import { defineSchema } from "taio/build/utils/json/schema/schema-factory";
import { createValidatorBySchema } from "taio/build/utils/json/schema/validator-factory";

declare global {
  //#region Environment variables defined by `esbuild`
  var __DEV__: boolean;
  var __EXTENSION__: string;
  var __CONFIGURATION__: string;
  var __ROOT__: string;
  //#endregion
}

type MessageOf<Map> = {
  [K in keyof Map]: {
    type: K;
    data: Map[K];
  };
}[keyof Map];

const configSchema = defineSchema({
  type: "object",
  fields: {
    saveDir: {
      type: "string",
    },
  },
});

export type ExtensionConfiguration = CreateTypeBySchemaType<typeof configSchema>;
export const isConfiguration = createValidatorBySchema(configSchema);
export const defaultConfiguration: ExtensionConfiguration = {
  saveDir: "assets",
};
interface ExtensionMessages {
  configuration: ExtensionConfiguration;
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
