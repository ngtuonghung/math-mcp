import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vitest";
import createServer from "../src/index.js";

test("quoted MCP enum values and integer arithmetic are handled exactly", async () => {
    const client = new Client({ name: "test", version: "1.0.0" });
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const converted = await client.callTool({ name: "convertBase", arguments: { value: "ff", fromBase: "16", toBase: "10" } });
    expect(converted).toEqual({ content: [{ type: "text", text: "255" }] });

    const added = await client.callTool({ name: "add", arguments: { value: 9007199254740991, addend: 2 } });
    expect(added).toEqual({ content: [{ type: "text", text: "9007199254740993" }] });

    const zeroPower = await client.callTool({ name: "power", arguments: { value: 0, exponent: -1 } });
    expect(zeroPower).toMatchObject({ isError: true });
    const fractionalZeroPower = await client.callTool({ name: "power", arguments: { value: 0, exponent: -0.5 } });
    expect(fractionalZeroPower).toMatchObject({ isError: true });

    const emptyMode = await client.callTool({ name: "mode", arguments: { numbers: [] } });
    expect(emptyMode).toMatchObject({ isError: true });

    await client.close();
    await server.close();
});
