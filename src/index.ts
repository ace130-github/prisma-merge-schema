import { Command, Flags } from "@oclif/core";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { globSync } from "glob";
import isGlob from "is-glob";

const fileReducer = (acc: string[], cur: string): string[] => {
  if (isGlob(cur)) {
    acc = [...acc, ...globSync(cur).map((item: string) => resolve(item))];
  } else {
    acc = [...acc, resolve(cur)];
  }
  return acc;
};

const fileWriterReducer = (acc: string, cur: string) =>
  acc + readFileSync(cur, "utf-8");

class PrismaMergeSchema extends Command {
  static description =
    "Merges a prisma datasource schema with a postfix schema";

  static flags = {
    // add --version flag to show CLI version
    version: Flags.version({ char: "v" }),
    help: Flags.help({ char: "h" }),
    datasource: Flags.string({ char: "d", required: true, multiple: true }),
    decorators: Flags.string({ char: "e", multiple: true }),
    outputFile: Flags.string({ char: "o" }),
  };

  applyExtensions = (str: string, extendsDecorations: any[] = []) => {
    extendsDecorations.forEach((extension) => {
      const [_, extendsTo, extendsWith] = extension.match(
        /extends ([^ ]* [^ ]*) \{([^}]*)/,
      ) as string[];
      const extendsToRegExp = new RegExp(`${extendsTo}[^}]*}`);
      const extendsToNext = str
        .match(extendsToRegExp)![0]
        .replace("}", extendsWith + "}");
      str = str.replace(extendsToRegExp, extendsToNext);
    });

    return str;
  };

  applyRemovals = (str: string, removeDecorations: any[] = []) => {
    removeDecorations.forEach((extension) => {
      let [_, modelToRemoveFrom, itemsToRemove]: any = extension.match(
        /remove ([^ ]* [^ ]*) \{([^}]*)/,
      ) as string[];

      itemsToRemove = itemsToRemove
        .split("\n")
        .filter((i: string) => i !== "")
        .map((i: string) => i.trim());

      // Find the line inside the appropriate model
      const splitStr: string[] = str.split("\n");

      // Create a trimmed, cloned version of the schema to compare against, and remove items from the
      // array based on this index
      [
        ...splitStr.map((i) => {
          i = i.replace(/^\s+/, "");
          if (!i.startsWith("model")) {
            i = i.substring(0, i.indexOf(" "));
          }
          return i;
        }),
      ].forEach((line, idx, thisArray) => {
        if (line.trim().startsWith(modelToRemoveFrom)) {
          for (const itemToRemove of itemsToRemove) {
            let lineToRemove: any = thisArray.indexOf(itemToRemove, idx);
            if (lineToRemove > -1) {
              delete splitStr[lineToRemove];
            }
          }
        }
      });

      str = splitStr.filter((item) => item && item !== "").join("\n");
    });

    return str;
  };

  applyReplacements = (str: string, replaceDecorations: any[] = []) => {
    replaceDecorations.forEach((extension) => {
      let [_, modelToReplaceIn, replacements]: any = extension.match(
        /replaces ([^ ]* [^ ]*) \{([^}]*)/,
      ) as string[];

      replacements = replacements
        .split("\n")
        .filter((i: string) => i !== "")
        .map((i: string) => {
          const content = i.trim();
          return {
            linePrefix: content.substring(0, content.indexOf(" ")),
            content,
          };
        });

      // Find the line inside the appropriate model
      const splitStr = str.split("\n");

      const leftTrimmed = [
        ...splitStr.map((i) => {
          i = i.replace(/^\s+/, "");
          if (!i.startsWith("model")) {
            i = i.substring(0, i.indexOf(" "));
          }
          return i;
        }),
      ];

      // find the index of the model to replace in
      const modelIndex = leftTrimmed.findIndex((line) =>
        line.startsWith(modelToReplaceIn),
      );

      if (modelIndex > -1) {
        for (const replacement of replacements) {
          const lineIndex = leftTrimmed.indexOf(
            replacement.linePrefix,
            modelIndex,
          );
          if (lineIndex > -1) {
            splitStr[lineIndex] = replacement.content;
          }
        }
      }
      str = splitStr.join("\n");
    });

    return str;
  };

  prismaSchemaMerge = (schema: string): string => {
    // Detect the line ending used in the source content so the output matches
    // the input regardless of which OS is running the tool. This is important
    // for Docker-on-Windows where the container is Linux but the mounted files
    // still use CRLF.
    const eol = schema.includes("\r\n") ? "\r\n" : "\n";

    // Normalise to LF for all internal processing.
    schema = schema.replace(/\r\n/g, "\n");

    const removeDecorators = schema
      .replace(/extends [^{]*[^}]*\}/gs, "")
      .replace(/replaces [^{]*[^}]*\}/gs, "")
      .replace(/remove [^{]*[^}]*\}/gs, "");

    const extensions = schema.match(/extends [^{]*[^}]*\}/gs) || [];
    const removals = schema.match(/remove [^{]*[^}]*\}/gs) || [];
    const replacements = schema.match(/replaces [^{]*[^}]*\}/gs) || [];

    let merged: any = removeDecorators;

    // FIXME: Conditionally apply these based on flags
    merged = this.applyExtensions(merged, extensions);
    merged = this.applyRemovals(merged, removals);
    merged = this.applyReplacements(merged, replacements);

    // Restore the original line endings.
    if (eol !== "\n") {
      merged = merged.replace(/\n/g, eol);
    }

    return merged;
  };

  async run() {
    const { flags } = await this.parse(PrismaMergeSchema);
    let decoratorFiles: any = [];
    let decoratorFileAsString: string = "";
    const datasourceFiles = flags.datasource.reduce(fileReducer, []);

    if (!datasourceFiles.length) {
      this.error("No datasource files found");
    }

    if (flags.decorators) {
      decoratorFiles = flags.decorators.reduce(fileReducer, []);
      decoratorFileAsString = decoratorFiles.reduce(fileWriterReducer, "");
    }

    const datasourceFileAsString = datasourceFiles.reduce(
      fileWriterReducer,
      "",
    );

    const outputPath = resolve(flags.outputFile || "./prisma/schema.prisma");
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      this.error(
        `Directory ${outputDir} does not exist. If you don't specify --output-file the CLI defaults to ./prisma/schema.prisma`,
      );
    }

    const schemaRaw: any =
      datasourceFileAsString.toString() + decoratorFileAsString.toString();

    // Detect EOL from content for the header line too.
    const eol = schemaRaw.includes("\r\n") ? "\r\n" : "\n";

    const schemaMerged: any =
      `// This file was generated by prisma-merge-schema (https://www.npmjs.com/package/prisma-merge-schema)${eol}` +
      this.prismaSchemaMerge(schemaRaw);

    writeFileSync(outputPath, schemaMerged, "utf-8");
    this.log(`File ${outputPath} created.`);
  }
}

export = PrismaMergeSchema;
