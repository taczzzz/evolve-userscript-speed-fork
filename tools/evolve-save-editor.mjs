#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

const HELP = `
Evolve save editor

Usage:
  node tools/evolve-save-editor.mjs <save.txt> [options]

Common edits:
  --probes <n>             Set interstellar probe count.
  --stellar-exotic <n>     Set interstellar.stellar_engine.exotic.
  --plasmids <n>           Set prestige.Plasmid count.
  --antiplasmids <n>       Set prestige.AntiPlasmid count.
  --phage <n>              Set prestige.Phage count.
  --dark-energy <n>        Set prestige.Dark count.
  --resource <name=value>  Set a resource amount; repeatable. value can be max.

Utility:
  --print                  Decode and print the supported fields.
  --list-resources         List resource keys present in the save.
  --dump-json <path>       Decode the save to JSON without editing it.
  --dry-run                Show planned changes without writing.
  --self-test              Run a local compression round-trip check.
  -h, --help               Show this help.

Examples:
  node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --probes 100 --stellar-exotic 1e9
  node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --plasmids 100000 --antiplasmids 100000 --phage 5000 --dark-energy 100
  node tools/evolve-save-editor.mjs ~/Downloads/evolve.txt --resource 精金=max --resource 地狱石=100m
`.trim();

const RESOURCE_ALIASES = buildResourceAliases([
  ["Food", "食物"],
  ["Lumber", "木材"],
  ["Chrysotile", "温石棉"],
  ["Stone", "石头"],
  ["Crystal", "水晶"],
  ["Furs", "毛皮"],
  ["Copper", "铜"],
  ["Iron", "铁"],
  ["Aluminium", "铝", "Aluminum"],
  ["Cement", "水泥"],
  ["Coal", "煤"],
  ["Oil", "石油"],
  ["Uranium", "铀"],
  ["Steel", "钢"],
  ["Titanium", "钛"],
  ["Alloy", "合金"],
  ["Polymer", "聚合物"],
  ["Iridium", "铱"],
  ["Helium_3", "氦-3", "氦3"],
  ["Water", "水"],
  ["Deuterium", "氘"],
  ["Neutronium", "中子"],
  ["Adamantite", "精金"],
  ["Infernite", "地狱石"],
  ["Elerium", "超铀"],
  ["Nano_Tube", "纳米管", "Nano Tube"],
  ["Graphene", "石墨烯"],
  ["Stanene", "锡烯"],
  ["Bolognium", "钋"],
  ["Vitreloy", "金属玻璃"],
  ["Orichalcum", "奥利哈刚"],
  ["Asphodel_Powder", "水仙花粉"],
  ["Elysanite", "净土石"],
  ["Unobtainium", "难得素"],
  ["Materials", "原材料"],
  ["Horseshoe", "马蹄铁"],
  ["Nanite", "纳米体"],
  ["Genes", "基因"],
  ["Soul_Gem", "灵魂宝石", "Soul Gem"],
  ["Plywood", "胶合板"],
  ["Brick", "砌砖"],
  ["Wrought_Iron", "锻铁", "Wrought Iron"],
  ["Sheet_Metal", "金属板", "Sheet Metal"],
  ["Mythril", "秘银"],
  ["Aerogel", "气凝胶"],
  ["Nanoweave", "纳米织物"],
  ["Scarletite", "绯绯色金"],
  ["Quantium", "量子"],
  ["Corrupt_Gem", "腐化的灵魂宝石", "Corrupt Gem"],
  ["Codex", "法典"],
  ["Cipher", "加密数据"],
  ["Demonic_Essence", "恶魔精华"],
  ["Blessed_Essence", "神圣精华"],
  ["Blood_Stone", "鲜血之石", "Blood Stone"],
  ["Artifact", "上古遗物"],
  ["Plasmid", "质粒"],
  ["Antiplasmid", "反质粒", "AntiPlasmid", "Anti Plasmid"],
  ["Supercoiled", "超螺旋质粒"],
  ["Phage", "噬菌体"],
  ["Dark", "暗能量"],
  ["Harmony", "和谐水晶"],
  ["AICore", "AI核心", "AI Core"],
]);

const SUFFIX_MULTIPLIERS = [
  ["dc", 1e33],
  ["no", 1e30],
  ["oc", 1e27],
  ["sp", 1e24],
  ["sx", 1e21],
  ["qi", 1e18],
  ["qa", 1e15],
  ["t", 1e12],
  ["b", 1e9],
  ["m", 1e6],
  ["k", 1e3],
  ["亿", 1e8],
  ["万", 1e4],
];

function buildResourceAliases(rows) {
  const aliases = new Map();
  for (const [key, ...names] of rows) {
    aliases.set(normalizeName(key), key);
    aliases.set(normalizeName(key.replaceAll("_", " ")), key);
    for (const name of names) {
      aliases.set(normalizeName(name), key);
    }
  }
  return aliases;
}

function normalizeName(value) {
  return String(value).trim().toLowerCase().replaceAll(/\s+/g, "");
}

function getBaseValue(alphabet, character) {
  const index = alphabet.indexOf(character);
  return index >= 0 ? index : undefined;
}

// Embedded LZ-String compatible codec for Evolve export/import saves.
const LZString = {
  compressToBase64(input) {
    if (input == null) {
      return "";
    }
    const output = this._compress(String(input), 6, (value) => BASE64_ALPHABET.charAt(value));
    switch (output.length % 4) {
      case 0:
        return output;
      case 1:
        return `${output}===`;
      case 2:
        return `${output}==`;
      case 3:
        return `${output}=`;
      default:
        return output;
    }
  },

  decompressFromBase64(input) {
    if (input == null) {
      return "";
    }
    if (input === "") {
      return null;
    }
    return this._decompress(input.length, 32, (index) => getBaseValue(BASE64_ALPHABET, input.charAt(index)));
  },

  _compress(uncompressed, bitsPerChar, getCharFromInt) {
    if (uncompressed == null) {
      return "";
    }

    let value;
    const dictionary = {};
    const dictionaryToCreate = {};
    let c = "";
    let wc = "";
    let w = "";
    let enlargeIn = 2;
    let dictSize = 3;
    let numBits = 2;
    const data = [];
    let dataVal = 0;
    let dataPosition = 0;

    const writeBit = (bit) => {
      dataVal = (dataVal << 1) | bit;
      if (dataPosition === bitsPerChar - 1) {
        dataPosition = 0;
        data.push(getCharFromInt(dataVal));
        dataVal = 0;
      } else {
        dataPosition += 1;
      }
    };

    const writeValue = (bits, numericValue) => {
      let current = numericValue;
      for (let i = 0; i < bits; i += 1) {
        writeBit(current & 1);
        current >>= 1;
      }
    };

    const maybeGrow = () => {
      enlargeIn -= 1;
      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits += 1;
      }
    };

    for (let ii = 0; ii < uncompressed.length; ii += 1) {
      c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(dictionary, c)) {
        dictionary[c] = dictSize;
        dictSize += 1;
        dictionaryToCreate[c] = true;
      }

      wc = w + c;
      if (Object.prototype.hasOwnProperty.call(dictionary, wc)) {
        w = wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(dictionaryToCreate, w)) {
          if (w.charCodeAt(0) < 256) {
            writeValue(numBits, 0);
            writeValue(8, w.charCodeAt(0));
          } else {
            writeValue(numBits, 1);
            writeValue(16, w.charCodeAt(0));
          }
          maybeGrow();
          delete dictionaryToCreate[w];
        } else {
          writeValue(numBits, dictionary[w]);
        }
        maybeGrow();
        dictionary[wc] = dictSize;
        dictSize += 1;
        w = String(c);
      }
    }

    if (w !== "") {
      if (Object.prototype.hasOwnProperty.call(dictionaryToCreate, w)) {
        if (w.charCodeAt(0) < 256) {
          writeValue(numBits, 0);
          writeValue(8, w.charCodeAt(0));
        } else {
          writeValue(numBits, 1);
          writeValue(16, w.charCodeAt(0));
        }
        maybeGrow();
        delete dictionaryToCreate[w];
      } else {
        writeValue(numBits, dictionary[w]);
      }
      maybeGrow();
    }

    writeValue(numBits, 2);

    while (true) {
      dataVal <<= 1;
      if (dataPosition === bitsPerChar - 1) {
        data.push(getCharFromInt(dataVal));
        break;
      }
      dataPosition += 1;
    }

    return data.join("");
  },

  _decompress(length, resetValue, getNextValue) {
    const dictionary = [];
    let next;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = "";
    const result = [];
    let bits;
    let resb;
    let maxpower;
    let power;
    let c;
    const data = {
      val: getNextValue(0),
      position: resetValue,
      index: 1,
    };

    const readBits = (count) => {
      bits = 0;
      maxpower = 2 ** count;
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index);
          data.index += 1;
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      return bits;
    };

    for (let i = 0; i < 3; i += 1) {
      dictionary[i] = i;
    }

    next = readBits(2);
    switch (next) {
      case 0:
        c = String.fromCharCode(readBits(8));
        break;
      case 1:
        c = String.fromCharCode(readBits(16));
        break;
      case 2:
        return "";
      default:
        return null;
    }

    dictionary[3] = c;
    let w = c;
    result.push(c);

    while (true) {
      if (data.index > length) {
        return "";
      }

      c = readBits(numBits);
      switch (c) {
        case 0:
          dictionary[dictSize] = String.fromCharCode(readBits(8));
          c = dictSize;
          dictSize += 1;
          enlargeIn -= 1;
          break;
        case 1:
          dictionary[dictSize] = String.fromCharCode(readBits(16));
          c = dictSize;
          dictSize += 1;
          enlargeIn -= 1;
          break;
        case 2:
          return result.join("");
        default:
          break;
      }

      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits += 1;
      }

      if (dictionary[c]) {
        entry = dictionary[c];
      } else if (c === dictSize) {
        entry = w + w.charAt(0);
      } else {
        return null;
      }

      result.push(entry);
      dictionary[dictSize] = w + entry.charAt(0);
      dictSize += 1;
      enlargeIn -= 1;
      w = entry;

      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits += 1;
      }
    }
  },
};

function parseArgs(argv) {
  const options = {
    edits: [],
    resources: [],
    dryRun: false,
    dumpJson: null,
    listResources: false,
    print: false,
    selfTest: false,
    help: false,
    savePath: null,
  };

  const readValue = (flag, index) => {
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--print":
        options.print = true;
        break;
      case "--list-resources":
        options.listResources = true;
        break;
      case "--dump-json":
        options.dumpJson = readValue(arg, i);
        i += 1;
        break;
      case "--probes":
      case "--probe":
        options.edits.push({ type: "probes", valueText: readValue(arg, i) });
        i += 1;
        break;
      case "--stellar-exotic":
      case "--stellar-engine-exotic":
        options.edits.push({ type: "stellar-exotic", valueText: readValue(arg, i) });
        i += 1;
        break;
      case "--plasmid":
      case "--plasmids":
        options.edits.push({ type: "prestige", key: "Plasmid", valueText: readValue(arg, i), label: "plasmids" });
        i += 1;
        break;
      case "--antiplasmid":
      case "--antiplasmids":
        options.edits.push({ type: "prestige", key: "AntiPlasmid", valueText: readValue(arg, i), label: "antiplasmids" });
        i += 1;
        break;
      case "--phage":
        options.edits.push({ type: "prestige", key: "Phage", valueText: readValue(arg, i), label: "phage" });
        i += 1;
        break;
      case "--dark":
      case "--dark-energy":
        options.edits.push({ type: "prestige", key: "Dark", valueText: readValue(arg, i), label: "dark energy" });
        i += 1;
        break;
      case "--resource":
      case "-r":
        options.resources.push(readValue(arg, i));
        i += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (options.savePath) {
          throw new Error(`Unexpected extra argument: ${arg}`);
        }
        options.savePath = arg;
        break;
    }
  }

  for (const resourceSpec of options.resources) {
    const equalIndex = resourceSpec.indexOf("=");
    if (equalIndex <= 0) {
      throw new Error(`--resource must look like name=value: ${resourceSpec}`);
    }
    options.edits.push({
      type: "resource",
      name: resourceSpec.slice(0, equalIndex),
      valueText: resourceSpec.slice(equalIndex + 1),
      label: resourceSpec.slice(0, equalIndex),
    });
  }

  return options;
}

function parseNumericValue(rawValue) {
  const text = String(rawValue).trim().replaceAll(",", "").replaceAll("_", "");
  if (!text) {
    throw new Error("Numeric value cannot be empty");
  }

  for (const [suffix, multiplier] of SUFFIX_MULTIPLIERS) {
    if (text.toLowerCase().endsWith(suffix)) {
      const numberText = text.slice(0, -suffix.length);
      const parsed = Number(numberText);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric value: ${rawValue}`);
      }
      return parsed * multiplier;
    }
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${rawValue}`);
  }
  return parsed;
}

function parseResourceValue(resource, rawValue) {
  const text = String(rawValue).trim();
  if (["max", "上限", "cap", "full"].includes(text.toLowerCase())) {
    if (!Object.prototype.hasOwnProperty.call(resource, "max")) {
      throw new Error("Resource has no max field");
    }
    const max = Number(resource.max);
    if (!Number.isFinite(max)) {
      throw new Error(`Resource max is not numeric: ${resource.max}`);
    }
    return max;
  }
  return parseNumericValue(text);
}

function readSave(savePath) {
  const rawFile = fs.readFileSync(savePath, "utf8");
  const compressed = rawFile.trim();
  const jsonText = LZString.decompressFromBase64(compressed);
  if (!jsonText) {
    throw new Error(`Could not decode ${savePath} as LZString Base64`);
  }

  try {
    return {
      rawFile,
      compressed,
      data: JSON.parse(jsonText),
    };
  } catch (error) {
    throw new Error(`Decoded save is not valid JSON: ${error.message}`);
  }
}

function writeSave(savePath, originalRawFile, data) {
  const encoded = LZString.compressToBase64(JSON.stringify(data));
  const newline = /\r?\n$/.test(originalRawFile) ? "\n" : "";
  fs.writeFileSync(savePath, `${encoded}${newline}`, "utf8");
}

function getAtPath(root, pathParts) {
  let current = root;
  for (const part of pathParts) {
    if (current == null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { exists: false, value: undefined };
    }
    current = current[part];
  }
  return { exists: true, value: current };
}

function setAtExistingPath(root, pathParts, value, label) {
  const current = getAtPath(root, pathParts);
  if (!current.exists) {
    throw new Error(`Missing path: ${pathParts.join(".")}`);
  }

  let parent = root;
  for (const part of pathParts.slice(0, -1)) {
    parent = parent[part];
  }
  const leaf = pathParts[pathParts.length - 1];
  const before = parent[leaf];
  parent[leaf] = value;
  return {
    label,
    path: pathParts,
    before,
    after: value,
  };
}

function resolveResourceKey(data, nameOrKey) {
  if (!data.resource || typeof data.resource !== "object") {
    throw new Error("Save has no resource object");
  }

  if (Object.prototype.hasOwnProperty.call(data.resource, nameOrKey)) {
    return nameOrKey;
  }

  const aliasKey = RESOURCE_ALIASES.get(normalizeName(nameOrKey));
  if (aliasKey && Object.prototype.hasOwnProperty.call(data.resource, aliasKey)) {
    return aliasKey;
  }

  for (const [key, resource] of Object.entries(data.resource)) {
    if (normalizeName(key) === normalizeName(nameOrKey)) {
      return key;
    }
    if (resource && typeof resource === "object") {
      for (const field of ["name", "display", "label"]) {
        if (resource[field] != null && normalizeName(resource[field]) === normalizeName(nameOrKey)) {
          return key;
        }
      }
    }
  }

  throw new Error(`Unknown or missing resource: ${nameOrKey}`);
}

function getResourceAmountField(resource, key) {
  for (const field of ["amount", "value"]) {
    if (Object.prototype.hasOwnProperty.call(resource, field)) {
      return field;
    }
  }
  throw new Error(`resource.${key} has no amount/value field`);
}

function setResourceAmount(data, nameOrKey, rawValue, label) {
  const key = resolveResourceKey(data, nameOrKey);
  const resource = data.resource[key];
  if (!resource || typeof resource !== "object") {
    throw new Error(`resource.${key} is not an object`);
  }
  const amountField = getResourceAmountField(resource, key);
  const value = parseResourceValue(resource, rawValue);
  return setAtExistingPath(data, ["resource", key, amountField], value, label ?? key);
}

function setPrestigeCount(data, key, rawValue, label) {
  if (!data.prestige || typeof data.prestige !== "object") {
    throw new Error("Save has no prestige object");
  }
  if (!Object.prototype.hasOwnProperty.call(data.prestige, key)) {
    throw new Error(`Missing prestige resource: ${key}`);
  }
  const item = data.prestige[key];
  if (!item || typeof item !== "object" || !Object.prototype.hasOwnProperty.call(item, "count")) {
    throw new Error(`prestige.${key} has no count field`);
  }
  return setAtExistingPath(data, ["prestige", key, "count"], parseNumericValue(rawValue), label ?? key);
}

function setProbeCount(data, rawValue) {
  const value = parseNumericValue(rawValue);
  const candidatePaths = [
    ["starDock", "probes", "count"],
    ["space", "star_dock", "probe"],
  ];
  const changes = [];
  const skipped = [];

  for (const pathParts of candidatePaths) {
    const current = getAtPath(data, pathParts);
    if (!current.exists) {
      continue;
    }
    if (typeof current.value !== "number") {
      skipped.push(`${pathParts.join(".")} (${typeof current.value})`);
      continue;
    }
    changes.push(setAtExistingPath(data, pathParts, value, "probes"));
  }

  if (changes.length === 0) {
    const suffix = skipped.length > 0 ? `; skipped non-number fields: ${skipped.join(", ")}` : "";
    throw new Error(`No numeric probe count field found${suffix}`);
  }

  return changes;
}

function applyEdit(data, edit) {
  switch (edit.type) {
    case "probes":
      return setProbeCount(data, edit.valueText);
    case "stellar-exotic":
      return [
        setAtExistingPath(
          data,
          ["interstellar", "stellar_engine", "exotic"],
          parseNumericValue(edit.valueText),
          "stellar exotic",
        ),
      ];
    case "resource":
      return [setResourceAmount(data, edit.key ?? edit.name, edit.valueText, edit.label)];
    case "prestige":
      return [setPrestigeCount(data, edit.key, edit.valueText, edit.label)];
    default:
      throw new Error(`Unsupported edit type: ${edit.type}`);
  }
}

function makeBackupPath(savePath) {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
  return `${savePath}.bak-${stamp}`;
}

function formatValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return JSON.stringify(value);
}

function printSnapshot(data) {
  const rows = [];
  const addPath = (label, pathParts) => {
    const current = getAtPath(data, pathParts);
    if (current.exists) {
      rows.push([label, pathParts.join("."), current.value]);
    }
  };

  addPath("Probe count", ["starDock", "probes", "count"]);
  addPath("Probe state", ["space", "star_dock", "probe"]);
  addPath("Stellar exotic", ["interstellar", "stellar_engine", "exotic"]);

  for (const [label, key] of [
    ["Plasmids", "Plasmid"],
    ["Phage", "Phage"],
    ["Dark energy", "Dark"],
  ]) {
    const prestige = getAtPath(data, ["prestige", key, "count"]);
    if (prestige.exists) {
      rows.push([label, `prestige.${key}.count`, prestige.value]);
      continue;
    }
    const resource = getAtPath(data, ["resource", key]);
    if (resource.exists && resource.value && typeof resource.value === "object") {
      const amountField = getOptionalAmountField(resource.value);
      if (amountField) {
        rows.push([label, `resource.${key}.${amountField}`, resource.value[amountField]]);
      }
    }
  }

  console.log("Decoded OK");
  if (rows.length === 0) {
    console.log("No supported fields found in this save.");
    return;
  }
  for (const [label, fieldPath, value] of rows) {
    console.log(`- ${label}: ${formatValue(value)} (${fieldPath})`);
  }
}

function listResources(data) {
  if (!data.resource || typeof data.resource !== "object") {
    throw new Error("Save has no resource object");
  }

  for (const [key, resource] of Object.entries(data.resource)) {
    const amountField = resource && typeof resource === "object" ? getOptionalAmountField(resource) : null;
    const amount = amountField ? `=${formatValue(resource[amountField])}` : "";
    const max = resource && typeof resource === "object" && Object.prototype.hasOwnProperty.call(resource, "max")
      ? ` max=${formatValue(resource.max)}`
      : "";
    console.log(`${key}${amount}${max}`);
  }
}

function getOptionalAmountField(resource) {
  for (const field of ["amount", "value"]) {
    if (Object.prototype.hasOwnProperty.call(resource, field)) {
      return field;
    }
  }
  return null;
}

function verifyChanges(data, changes) {
  const failures = [];
  for (const change of changes) {
    const current = getAtPath(data, change.path);
    if (!current.exists || current.value !== change.after) {
      failures.push(`${change.path.join(".")} expected ${formatValue(change.after)} got ${formatValue(current.value)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Reread verification failed:\n${failures.join("\n")}`);
  }
}

function printChanges(changes) {
  for (const change of changes) {
    console.log(`- ${change.path.join(".")}: ${formatValue(change.before)} -> ${formatValue(change.after)}`);
  }
}

function runSelfTest() {
  const sample = {
    resource: {
      Plasmid: { amount: 42, max: 100 },
      Adamantite: { amount: 1, max: 9 },
    },
    prestige: {
      Plasmid: { count: 42 },
      Phage: { count: 7 },
      Dark: { count: 0.5 },
    },
    interstellar: { stellar_engine: { exotic: 0.025 } },
    starDock: { probes: { count: 3 } },
    space: { star_dock: { probe: 3 } },
    marker: "中文 round-trip",
  };
  const json = JSON.stringify(sample);
  const encoded = LZString.compressToBase64(json);
  const decoded = LZString.decompressFromBase64(encoded);
  if (decoded !== json) {
    throw new Error("LZString round-trip mismatch");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-save-editor-"));
  try {
    const savePath = path.join(tmpDir, "save.txt");
    fs.writeFileSync(savePath, encoded, "utf8");
    const save = readSave(savePath);
    const changes = [
      ...setProbeCount(save.data, "10"),
      setAtExistingPath(save.data, ["interstellar", "stellar_engine", "exotic"], parseNumericValue("1e9"), "stellar exotic"),
      setPrestigeCount(save.data, "Plasmid", "1000", "plasmids"),
      setResourceAmount(save.data, "精金", "max", "精金"),
    ];
    const backupPath = makeBackupPath(savePath);
    fs.copyFileSync(savePath, backupPath);
    writeSave(savePath, save.rawFile, save.data);
    const reread = readSave(savePath);
    verifyChanges(reread.data, changes);
    if (!fs.existsSync(backupPath)) {
      throw new Error("Backup was not created");
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("Self-test OK");
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  if (!options.savePath) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const savePath = path.resolve(options.savePath);
  const save = readSave(savePath);

  if (options.dumpJson && options.edits.length > 0) {
    throw new Error("--dump-json is decode-only; run edits separately");
  }
  if (options.dumpJson) {
    fs.writeFileSync(path.resolve(options.dumpJson), `${JSON.stringify(save.data, null, 2)}\n`, "utf8");
    console.log(`Decoded JSON written: ${path.resolve(options.dumpJson)}`);
    return;
  }
  if (options.listResources) {
    listResources(save.data);
  }

  if (options.edits.length === 0) {
    if (!options.listResources) {
      printSnapshot(save.data);
    }
    return;
  }

  const changes = options.edits.flatMap((edit) => applyEdit(save.data, edit));
  console.log(options.dryRun ? "Planned changes:" : "Applied changes:");
  printChanges(changes);

  if (options.dryRun) {
    console.log("Dry run only; save file was not changed.");
    return;
  }

  const backupPath = makeBackupPath(savePath);
  fs.copyFileSync(savePath, backupPath);
  writeSave(savePath, save.rawFile, save.data);

  const reread = readSave(savePath);
  verifyChanges(reread.data, changes);
  console.log(`Backup: ${backupPath}`);
  console.log(`Updated: ${savePath}`);
  console.log("Reread verification OK");
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
