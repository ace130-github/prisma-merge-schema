import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import PrismaMergeSchema from "../src";

describe("prismaSchemaMerge", () => {
  const cmd = new PrismaMergeSchema([], {} as any);

  it("returns schema unchanged when no decorators are present", () => {
    const schema = `
model User {
  id   Int    @id
  name String
}
`.trim();
    // Normalise line endings before comparing — prismaSchemaMerge converts to os.EOL.
    const result = cmd.prismaSchemaMerge(schema).replace(/\r\n/g, "\n");
    expect(result).to.equal(schema.replace(/\r\n/g, "\n"));
  });

  it("applies extends decorator to add fields to a model", () => {
    const schema = `
model User {
  id   Int    @id
  name String
}

extends model User {
  email String
}
`.trim();
    const result = cmd.prismaSchemaMerge(schema);
    expect(result).to.contain("email String");
    expect(result).to.contain("id   Int    @id");
  });

  it("applies remove decorator to remove a field from a model", () => {
    const schema = `
model User {
  id    Int    @id
  name  String
  email String
}

remove model User {
  email
}
`.trim();
    const result = cmd.prismaSchemaMerge(schema);
    expect(result).not.to.contain("email");
    expect(result).to.contain("name  String");
  });

  it("applies replaces decorator to replace a field in a model", () => {
    const schema = `
model User {
  id    Int    @id
  name  String
}

replaces model User {
  name  String @unique
}
`.trim();
    const result = cmd.prismaSchemaMerge(schema);
    expect(result).to.contain("name  String @unique");
    expect(result).not.to.contain("name  String\n");
  });

  it("strips decorator blocks from the output", () => {
    const schema = `
model User {
  id   Int    @id
  name String
}

extends model User {
  email String
}
`.trim();
    const result = cmd.prismaSchemaMerge(schema);
    expect(result).not.to.contain("extends model User");
  });
});

describe("prismaSchemaMerge (Windows CRLF line endings)", () => {
  const cmd = new PrismaMergeSchema([], {} as any);
  const CRLF = "\r\n";

  it("applies remove decorator with CRLF line endings", () => {
    const schema = [
      "model User {",
      "  id    Int    @id",
      "  name  String",
      "  email String",
      "}",
      "",
      "remove model User {",
      "  email",
      "}",
    ].join(CRLF);

    const result = cmd.prismaSchemaMerge(schema);
    expect(result).not.to.contain("email");
    expect(result).to.contain("name");
  });

  it("applies replaces decorator with CRLF line endings", () => {
    const schema = [
      "model User {",
      "  id    Int    @id",
      "  name  String",
      "}",
      "",
      "replaces model User {",
      "  name  String @unique",
      "}",
    ].join(CRLF);

    const result = cmd.prismaSchemaMerge(schema);
    expect(result).to.contain("name  String @unique");
  });

  it("replaces a field in a model with CRLF (regression: missing closing brace / field not replaced)", () => {
    const base = [
      "model studm_koop_hs {",
      '  tid                   Int                    @id(map: "pk_studm_koop_hs") @default(autoincrement())',
      "  studienmoeglichkeiten studienmoeglichkeiten? @relation(fields: [studienmoeglichkeit], references: [laufnummer], onDelete: NoAction, onUpdate: NoAction)",
      "}",
    ].join(CRLF);

    const decorator = [
      "replaces model studm_koop_hs {",
      "  studienmoeglichkeiten   studienmoeglichkeiten  @relation(fields: [studienmoeglichkeit], references: [laufnummer], onDelete: NoAction, onUpdate: NoAction)",
      "}",
    ].join(CRLF);

    const result = cmd.prismaSchemaMerge(base + CRLF + decorator);

    // The replacement must have been applied (field no longer optional)
    expect(result).not.to.contain("studienmoeglichkeiten?");
    expect(result).to.contain(
      "studienmoeglichkeiten   studienmoeglichkeiten  @relation",
    );

    // The model must have a clean closing brace: every `}` must be followed by
    // either EOL or end-of-string, not by a bare `\r` that is not part of `\r\n`.
    expect(result).not.to.match(/\}\r(?!\n)/);
  });

  it("replaces a field using actual resource files with CRLF line endings (regression)", () => {
    // Read the resource files as binary to preserve whatever line endings they have on disk,
    // then force CRLF to simulate Windows checkout behaviour.
    const baseLF = readFileSync(
      join(__dirname, "resources/base.prisma"),
      "utf-8",
    ).replace(/\r\n/g, "\n");
    const decoratorLF = readFileSync(
      join(__dirname, "resources/decorators.prisma"),
      "utf-8",
    ).replace(/\r\n/g, "\n");

    // Convert to CRLF to simulate Windows line endings
    const baseCRLF = baseLF.replace(/\n/g, "\r\n");
    const decoratorCRLF = decoratorLF.replace(/\n/g, "\r\n");

    const result = cmd.prismaSchemaMerge(baseCRLF + decoratorCRLF);

    // The replacement must have been applied (field no longer optional)
    expect(result).not.to.contain("studienmoeglichkeiten?");
    expect(result).to.contain(
      "studienmoeglichkeiten   studienmoeglichkeiten  @relation",
    );

    // Split into lines (normalise line endings first) and find the studm_koop_hs block.
    // Between the opening `model studm_koop_hs {` line and the next `model ` line,
    // there must be exactly one line that is just `}` (the closing brace of the block).
    const lines = result.replace(/\r\n/g, "\n").split("\n");
    const startIdx = lines.findIndex((l) =>
      l.startsWith("model studm_koop_hs"),
    );
    const nextModelIdx = lines.findIndex(
      (l, i) => i > startIdx && l.startsWith("model "),
    );
    const blockLines = lines.slice(startIdx, nextModelIdx);

    expect(
      blockLines.some((l) => l.trim() === "}"),
      "model studm_koop_hs block must have a closing } before the next model",
    ).to.be.true;

    expect(
      blockLines.some((l) =>
        l.includes("studienmoeglichkeiten   studienmoeglichkeiten"),
      ),
      "model studm_koop_hs block must contain the replaced field",
    ).to.be.true;
  });
});
