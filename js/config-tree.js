/** Mooshimeter ConfigTree protocol - hierarchical config tree with serial encoding. */

export const NTYPE = {
    PLAIN: 0,
    LINK: 1,
    CHOOSER: 2,
    VAL_U8: 3,
    VAL_U16: 4,
    VAL_U32: 5,
    VAL_S8: 6,
    VAL_S16: 7,
    VAL_S32: 8,
    VAL_STR: 9,
    VAL_BIN: 10,
    VAL_FLT: 11,
};

const NTYPE_NAMES = [
    "PLAIN", "LINK", "CHOOSER",
    "VAL_U8", "VAL_U16", "VAL_U32",
    "VAL_S8", "VAL_S16", "VAL_S32",
    "VAL_STR", "VAL_BIN", "VAL_FLT",
];

export class ConfigNode {
    constructor(ntype = -1, name = "", children = null) {
        this.code = -1;
        this.ntype = ntype;
        this.name = name;
        this.children = [];
        this.parent = null;
        this.value = null;
        this.notificationHandler = null;

        if (children) {
            for (const c of children) {
                if (c instanceof ConfigNode) {
                    this.children.push(c);
                } else {
                    this.children.push(new ConfigNode(NTYPE.PLAIN, String(c)));
                }
            }
        }
    }

    needsShortCode() {
        return this.ntype !== NTYPE.PLAIN && this.ntype !== NTYPE.LINK;
    }

    getLongName() {
        const parts = [];
        let node = this;
        while (node !== null) {
            if (node.name) parts.push(node.name);
            node = node.parent;
        }
        parts.reverse();
        return parts.length > 1 ? parts.slice(1).join(":") : (parts[0] || "");
    }

    getChildrenNames() {
        return this.children.map(c => c.name);
    }

    toString() {
        let s = "";
        if (this.code !== -1) s += `${this.code}:`;
        s += `${NTYPE_NAMES[this.ntype] || "?"}:${this.name}`;
        if (this.value !== null) s += `:${this.value}`;
        return s;
    }
}

export class ConfigTree {
    constructor(root = null) {
        this.root = root;
    }

    walk(callback, node = null) {
        if (node === null) {
            node = this.root;
            callback(node);
        }
        for (const c of node.children) {
            callback(c);
            this.walk(callback, c);
        }
    }

    assignShortCodes() {
        let code = 0;
        this.walk(node => {
            for (const c of node.children) {
                c.parent = node;
            }
            if (node.needsShortCode()) {
                node.code = code++;
            }
        });
    }

    getNodeAtLongname(longname) {
        const tokens = longname.toUpperCase().split(":");
        let n = this.root;
        for (const token of tokens) {
            let found = false;
            for (const c of n.children) {
                if (c.name === token) {
                    n = c;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }
        return n;
    }

    getShortCodeList() {
        const map = new Map();
        this.walk(node => {
            if (node.code !== -1) {
                map.set(node.code, node);
            }
        });
        return map;
    }

    deserialize(data, offset = { v: 0 }) {
        const ntype = data[offset.v++];
        const nlen = data[offset.v++];
        let name = "";
        for (let i = 0; i < nlen; i++) {
            name += String.fromCharCode(data[offset.v++]);
        }
        const nChildren = data[offset.v++];
        const children = [];
        for (let i = 0; i < nChildren; i++) {
            children.push(this.deserialize(data, offset));
        }
        return new ConfigNode(ntype, name, children);
    }

    unpack(compressedBytes) {
        // Decompress with pako (zlib)
        const decompressed = pako.inflate(new Uint8Array(compressedBytes));
        this.root = this.deserialize(decompressed, { v: 0 });
        this.assignShortCodes();
    }

    enumerate(node = null, indent = 0) {
        if (node === null) node = this.root;
        const lines = [" ".repeat(indent) + node.toString()];
        for (const c of node.children) {
            lines.push(...this.enumerate(c, indent + 2));
        }
        return lines;
    }
}

export function buildBootstrapTree() {
    const root = new ConfigNode(NTYPE.PLAIN, "", [
        new ConfigNode(NTYPE.PLAIN, "ADMIN", [
            new ConfigNode(NTYPE.VAL_U32, "CRC32"),
            new ConfigNode(NTYPE.VAL_BIN, "TREE"),
            new ConfigNode(NTYPE.VAL_STR, "DIAGNOSTIC"),
        ]),
    ]);
    const tree = new ConfigTree(root);
    tree.assignShortCodes();
    return tree;
}
