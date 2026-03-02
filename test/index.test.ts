import { expect } from "chai";
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
    expect(cmd.prismaSchemaMerge(schema)).to.equal(schema);
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
