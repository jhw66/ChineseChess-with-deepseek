import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PIKAFISH_NNUE_FILENAME = "pikafish.nnue";
export const PIKAFISH_NNUE_PARTS_DIRNAME = "nnue-parts";
export const PIKAFISH_NNUE_PART_PREFIX = "pikafish.nnue.part";
export const PIKAFISH_NNUE_SIZE = 50706378;
export const PIKAFISH_NNUE_SHA256 =
  "7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e";

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function modelIsValid(filePath, expectedSize, expectedSha256) {
  if (!fs.existsSync(filePath)) return false;
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size !== expectedSize) return false;
  return sha256File(filePath) === expectedSha256.toLowerCase();
}

function listModelParts(partsDir) {
  if (!fs.existsSync(partsDir)) return [];
  return fs
    .readdirSync(partsDir)
    .filter((name) => name.startsWith(PIKAFISH_NNUE_PART_PREFIX))
    .sort((a, b) => a.localeCompare(b, "en"));
}

export function ensureNnueModel(
  engineDir,
  {
    expectedSize = PIKAFISH_NNUE_SIZE,
    expectedSha256 = PIKAFISH_NNUE_SHA256,
    logger = console,
  } = {},
) {
  const targetPath = path.join(engineDir, PIKAFISH_NNUE_FILENAME);
  const partsDir = path.join(engineDir, PIKAFISH_NNUE_PARTS_DIRNAME);

  if (modelIsValid(targetPath, expectedSize, expectedSha256)) {
    return {
      assembled: false,
      targetPath,
      bytes: expectedSize,
      sha256: expectedSha256.toLowerCase(),
    };
  }

  const partNames = listModelParts(partsDir);
  if (!partNames.length) {
    throw new Error(
      `Pikafish NNUE model is missing. Expected ${PIKAFISH_NNUE_FILENAME} or NNUE parts in ${partsDir}.`,
    );
  }

  const partPaths = partNames.map((name) => path.join(partsDir, name));
  const totalBytes = partPaths.reduce(
    (sum, partPath) => sum + fs.statSync(partPath).size,
    0,
  );
  if (totalBytes !== expectedSize) {
    throw new Error(
      `Pikafish NNUE parts have ${totalBytes} bytes; expected ${expectedSize}.`,
    );
  }

  const temporaryPath = `${targetPath}.assembling`;
  const output = fs.openSync(temporaryPath, "w");
  try {
    for (const partPath of partPaths) {
      fs.appendFileSync(output, fs.readFileSync(partPath));
    }
  } finally {
    fs.closeSync(output);
  }

  const assembledSha256 = sha256File(temporaryPath);
  if (assembledSha256 !== expectedSha256.toLowerCase()) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(
      `Pikafish NNUE parts failed SHA-256 verification: ${assembledSha256}.`,
    );
  }

  fs.copyFileSync(temporaryPath, targetPath);
  fs.rmSync(temporaryPath, { force: true });
  logger.log(
    `Assembled ${PIKAFISH_NNUE_FILENAME} from ${partNames.length} verified parts.`,
  );
  return {
    assembled: true,
    targetPath,
    bytes: totalBytes,
    sha256: assembledSha256,
  };
}
