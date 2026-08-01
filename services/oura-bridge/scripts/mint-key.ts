import { mintIdentity } from "../src/identity.js";

const id = mintIdentity();
console.log(
  JSON.stringify({ nsec: id.nsec, pubkeyHex: id.pubkeyHex }, null, 2),
);
