// Optional host conveniences over the common two-record wire ABI.
const OUTPUT_BYTES=0x8000,INPUT_OFFSET=0x40000,DATA_OFFSET=0x80,SDK_BYTES=0x5e1000;
function callRecord(sdk, offset, args) {
  if (
    !Number.isSafeInteger(sdk) ||
    sdk < 0x1000 ||
    sdk >= 2 ** 39 ||
    sdk % 4 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= SDK_BYTES ||
    offset % 4 ||
    args.length !== 4
  )
    throw Error("Invalid SDK function or argument count");
  // JSON carries BigInt arguments as decimal strings.
  if (
    args.some(
      (value) =>
        typeof value !== "bigint" &&
        !Number.isSafeInteger(value) &&
        !(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value)),
    )
  )
    throw Error(
      "Native arguments must be exact integers; use BigInt for values above 2^53",
    );
  const words = [BigInt(sdk + offset), ...args.map(BigInt)];
  if (words.some((value) => value < 0n || value > 0xffffffffffffffffn))
    throw Error("Native arguments must fit uint64");
  const bytes = Buffer.alloc(40);
  words.forEach((value, index) => bytes.writeBigUInt64LE(value, index * 8));
  return bytes;
}

class Conveniences {
  async readMany(spans) {
    if (
      !Array.isArray(spans) ||
      spans.length < 1 ||
      spans.length > 8 ||
      spans.some(
        (s) =>
          !s ||
          !Number.isSafeInteger(s.address) ||
          s.address < 0x1000 ||
          !Number.isInteger(s.length) ||
          s.length < 1 ||
          s.address + s.length >= 2 ** 39 ||
          (s.address < this.output + OUTPUT_BYTES &&
            s.address + s.length > this.output),
      ) ||
      spans.reduce((n, s) => n + s.length, 0) > OUTPUT_BYTES
    )
      throw Error("Invalid bounded memory read batch");
    const regions = [];
    for (const { address, length } of spans)
      await this.guard(address, length, 1, regions);
    const parts = [];
    for (let i = 0; i < spans.length; i += 2) {
      const pair = spans.slice(i, i + 2);
      let offset = 0;
      const calls = pair.map((s) => {
        const call = {
          offset: 0x586fb0,
          args: [this.output + offset, s.address, s.length, 0],
        };
        offset += s.length;
        return call;
      });
      const reply = await this.exchange(calls);
      offset = 0;
      pair.forEach((s, j) => {
        if (reply.results[j] !== BigInt(this.output + offset))
          throw Error("Native batch read failed");
        parts.push(
          Buffer.from(reply.output.subarray(offset, offset + s.length)),
        );
        offset += s.length;
      });
    }
    return parts;
  }

  async writeCall(address, bytes, functionAddress, args) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > OUTPUT_BYTES ||
      !Array.isArray(args) ||
      args.length > 4 ||
      !this.functions.has(functionAddress)
    )
      throw Error("Invalid qualified write/call");
    const padded = [...args, ...Array(4 - args.length).fill(0)];
    callRecord(functionAddress, 0, padded); // Validate everything before writing.
    await this.guard(address, bytes.length, 2);
    const reply = await this.exchange(
      [
        {
          offset: 0x5872f0,
          args: [
            address,
            this.addresses.scratch + INPUT_OFFSET + DATA_OFFSET,
            bytes.length,
            0,
          ],
        },
        { address: functionAddress, args: padded },
      ],
      bytes,
    );
    if (reply.results[0] !== BigInt(address))
      throw Error("Native memory write failed; call was not replayed");
    return { result: reply.results[1] };
  }

}
function extendNative(native) {for (const method of ['readMany','writeCall']) if(typeof native[method]!=='function')Object.defineProperty(native,method,{value:Conveniences.prototype[method],configurable:true});return native;}
module.exports={extendNative};
