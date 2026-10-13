// compiles @webref/css and src/grammar/patch.json into the grammar tables the lexer embeds: every
// definition parsed once here, so the wasm carries trees, not text to parse at startup

const std = @import("std");
const grammar = @import("grammar");

const syntax = grammar.syntax;
const generic = grammar.generic;
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Writer = std.Io.Writer;
const Value = std.json.Value;
const Dict = std.StringArrayHashMapUnmanaged([]const u8);

const Atrule = struct {
    prelude: ?[]const u8,
    descriptors: Dict,
};

const Data = struct {
    types: Dict = .empty,
    properties: Dict = .empty,
    atrules: std.StringArrayHashMapUnmanaged(Atrule) = .empty,
};

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const args = try init.minimal.args.toSlice(arena);
    if (args.len != 3) fatal("usage: gen_grammar <@webref/css css.json> <patch.json>", .{});
    const cwd = std.Io.Dir.cwd();
    const limit: std.Io.Limit = .limited(64 * 1024 * 1024);
    const webref_text = try cwd.readFileAlloc(init.io, args[1], arena, limit);
    const patch_text = try cwd.readFileAlloc(init.io, args[2], arena, limit);
    const webref = try std.json.parseFromSliceLeaky(Value, arena, webref_text, .{});
    const patch = try std.json.parseFromSliceLeaky(Value, arena, patch_text, .{});

    var data: Data = .{};
    try assemble(arena, webref, &data);
    try applyPatch(arena, patch, &data);

    var out: Compiled = .{ .gpa = arena };
    try out.compile(&data);
    try out.validate();

    var buf: [64 * 1024]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(init.io, &buf);
    try out.write(&stdout.interface);
    try stdout.interface.flush();
}

fn fatal(comptime format: []const u8, args: anytype) noreturn {
    std.debug.print("gen_grammar: " ++ format ++ "\n", args);
    std.process.exit(1);
}

fn field(object: Value, name: []const u8) ?Value {
    assert(object == .object);
    return object.object.get(name);
}

fn string(value: ?Value) ?[]const u8 {
    const v = value orelse return null;
    return if (v == .string) v.string else null;
}

fn array(object: Value, name: []const u8) []const Value {
    const value = field(object, name) orelse fatal("missing `{s}`", .{name});
    if (value != .array) fatal("`{s}` is not an array", .{name});
    return value.array.items;
}

// webref's types and functions, minus the generic types the lexer matches in code; a name defined
// for several scopes accepts each of its definitions
fn assemble(gpa: Allocator, webref: Value, data: *Data) !void {
    for ([_][]const u8{ "types", "functions" }) |category| {
        for (array(webref, category)) |feature| {
            const name = string(field(feature, "name")) orelse fatal("a feature has no name", .{});
            const text = string(field(feature, "syntax")) orelse continue;
            if (generic.find(name) != null) continue;
            const entry = try data.types.getOrPut(gpa, name);
            if (entry.found_existing and !std.mem.eql(u8, entry.value_ptr.*, text)) {
                entry.value_ptr.* = try std.fmt.allocPrint(
                    gpa,
                    "{s} | {s}",
                    .{ entry.value_ptr.*, text },
                );
            } else entry.value_ptr.* = text;
        }
    }
    for (array(webref, "properties")) |feature| {
        const name = string(field(feature, "name")) orelse fatal("a property has no name", .{});
        const text = string(field(feature, "syntax")) orelse continue;
        try data.properties.put(gpa, name, text);
    }
    for (array(webref, "atrules")) |feature| {
        const full = string(field(feature, "name")) orelse fatal("an at-rule has no name", .{});
        assert(full[0] == '@');
        var atrule: Atrule = .{ .prelude = null, .descriptors = .empty };
        if (string(field(feature, "syntax"))) |text| atrule.prelude = try preludeOf(gpa, text);
        for (array(feature, "descriptors")) |descriptor| {
            const name = string(
                field(descriptor, "name"),
            ) orelse fatal("a descriptor has no name", .{});
            const text = string(field(descriptor, "syntax")) orelse continue;
            try atrule.descriptors.put(gpa, name, text);
        }
        try data.atrules.put(gpa, full[1..], atrule);
    }
}

// css-tree's patch: null deletes, a syntax starting with `|` adds alternatives, any other replaces
fn patchDict(gpa: Allocator, dict: *Dict, patches: ?Value) !void {
    const object = patches orelse return;
    var it = object.object.iterator();
    while (it.next()) |entry| {
        const name = entry.key_ptr.*;
        const value = field(entry.value_ptr.*, "syntax") orelse continue;
        if (value == .null) {
            if (!dict.orderedRemove(name)) fatal(
                "the patch deletes `{s}`, which does not exist",
                .{name},
            );
            continue;
        }
        const text = std.mem.trim(u8, value.string, " \t\n");
        if (text.len > 0 and text[0] == '|') {
            if (dict.get(name)) |known| {
                try dict.put(gpa, name, try std.fmt.allocPrint(gpa, "{s} {s}", .{ known, text }));
                continue;
            }
            try dict.put(gpa, name, std.mem.trimStart(u8, text[1..], " "));
            continue;
        }
        try dict.put(gpa, name, text);
    }
}

fn applyPatch(gpa: Allocator, patch: Value, data: *Data) !void {
    try patchDict(gpa, &data.types, field(patch, "types"));
    try patchDict(gpa, &data.properties, field(patch, "properties"));
    const atrules = field(patch, "atrules") orelse return;
    var it = atrules.object.iterator();
    while (it.next()) |entry| {
        const atrule = try data.atrules.getOrPut(gpa, entry.key_ptr.*);
        if (!atrule.found_existing) atrule.value_ptr.* = .{
            .prelude = null,
            .descriptors = .empty,
        };
        if (field(entry.value_ptr.*, "prelude")) |prelude| {
            atrule.value_ptr.prelude = if (prelude == .null) null else prelude.string;
        }
        try patchDict(gpa, &atrule.value_ptr.descriptors, field(entry.value_ptr.*, "descriptors"));
    }
}

fn parseOrFail(gpa: Allocator, text: []const u8, nodes: *std.ArrayList(syntax.Node)) !void {
    var failure: syntax.Failure = undefined;
    syntax.parse(gpa, text, 0, nodes, &failure) catch |err| switch (err) {
        error.Syntax => fatal(
            "`{s}` does not parse: {s} at {d}",
            .{ text, failure.message.text(), failure.offset },
        ),
        else => return err,
    };
}

// the terms of a sequence, or the node alone
fn sequence(gpa: Allocator, nodes: []const syntax.Node, index: u32) ![]u32 {
    var terms: std.ArrayList(u32) = .empty;
    const node = nodes[index];
    const plain = node.tag == .group and node.flags & syntax.flag.explicit == 0;
    if (plain and node.combinator() == .juxtapose) {
        var at = index + 1;
        for (0..node.len) |_| {
            try terms.append(gpa, at);
            at = syntax.skip(nodes, at);
        }
    } else try terms.append(gpa, index);
    return terms.items;
}

fn endsPrelude(nodes: []const syntax.Node, text: []const u8, index: u32) bool {
    const end = syntax.skip(nodes, index);
    for (nodes[index..end]) |node| {
        if (node.tag != .token) continue;
        const t = node.text(text);
        if (std.mem.eql(u8, t, "{") or std.mem.eql(u8, t, ";")) return true;
    }
    return false;
}

/// An at-rule's prelude: the terms after the at-keyword up to its block or semicolon, of each
/// `@name ...` alternative.
fn preludeOf(gpa: Allocator, text: []const u8) !?[]const u8 {
    var nodes: std.ArrayList(syntax.Node) = .empty;
    try parseOrFail(gpa, text, &nodes);
    const root = nodes.items[0];
    var alternatives: []const u32 = &.{0};
    const plain = root.tag == .group and root.flags & syntax.flag.explicit == 0;
    if (plain and root.combinator() == .one) {
        var terms: std.ArrayList(u32) = .empty;
        var at: u32 = 1;
        var all_at = true;
        for (0..root.len) |_| {
            const seq = try sequence(gpa, nodes.items, at);
            all_at = all_at and nodes.items[seq[0]].tag == .at_keyword;
            try terms.append(gpa, at);
            at = syntax.skip(nodes.items, at);
        }
        if (all_at) alternatives = terms.items;
    }
    var preludes: std.ArrayList([]const u8) = .empty;
    var missing = false;
    for (alternatives) |alternative| {
        const terms = try sequence(gpa, nodes.items, alternative);
        if (nodes.items[terms[0]].tag != .at_keyword) {
            missing = true;
            continue;
        }
        var buf: std.Io.Writer.Allocating = .init(gpa);
        var count: u32 = 0;
        for (terms[1..]) |term| {
            if (endsPrelude(nodes.items, text, term)) break;
            if (count > 0) try buf.writer.writeAll(" ");
            _ = try syntax.generate(gpa, nodes.items, term, text, &buf.writer);
            count += 1;
        }
        if (count == 0) missing = true else try preludes.append(gpa, buf.written());
    }
    if (preludes.items.len == 0) return null;
    const joined = try std.mem.join(gpa, " | ", preludes.items);
    return if (missing) try std.fmt.allocPrint(gpa, "[ {s} ]?", .{joined}) else joined;
}

const Entry = struct {
    name: []const u8,
    root: u32,
};

const none = std.math.maxInt(u32);

const Compiled = struct {
    gpa: Allocator,
    text: std.ArrayList(u8) = .empty,
    interned: std.StringHashMapUnmanaged(u32) = .empty,
    nodes: std.ArrayList(syntax.Node) = .empty,
    types: std.ArrayList(Entry) = .empty,
    properties: std.ArrayList(Entry) = .empty,
    // an at-rule's root is its prelude's, and its descriptors follow in `descriptors`
    atrules: std.ArrayList(struct { entry: Entry, start: u32, len: u32 }) = .empty,
    descriptors: std.ArrayList(Entry) = .empty,

    fn intern(c: *Compiled, s: []const u8) !u32 {
        if (s.len == 0) return 0;
        const entry = try c.interned.getOrPut(c.gpa, s);
        if (!entry.found_existing) {
            entry.value_ptr.* = @intCast(c.text.items.len);
            try c.text.appendSlice(c.gpa, s);
        }
        return entry.value_ptr.*;
    }

    fn tree(c: *Compiled, text: []const u8) !u32 {
        var local: std.ArrayList(syntax.Node) = .empty;
        try parseOrFail(c.gpa, text, &local);
        const root: u32 = @intCast(c.nodes.items.len);
        for (local.items) |node| {
            var copy = node;
            switch (node.tag) {
                .group, .multiplier, .boolean, .comma => {},
                else => copy.data = try c.intern(node.text(text)),
            }
            try c.nodes.append(c.gpa, copy);
        }
        return root;
    }

    fn entries(c: *Compiled, dict: *const Dict, out: *std.ArrayList(Entry)) !void {
        for (dict.keys(), dict.values()) |name, text| {
            try out.append(c.gpa, .{ .name = name, .root = try c.tree(text) });
        }
        std.mem.sortUnstable(Entry, out.items, {}, lessThan);
    }

    fn lessThan(_: void, a: Entry, b: Entry) bool {
        return std.mem.lessThan(u8, a.name, b.name);
    }

    fn compile(c: *Compiled, data: *Data) !void {
        try c.entries(&data.types, &c.types);
        try c.entries(&data.properties, &c.properties);
        var names: std.ArrayList([]const u8) = .empty;
        try names.appendSlice(c.gpa, data.atrules.keys());
        std.mem.sortUnstable([]const u8, names.items, {}, stringLess);
        for (names.items) |name| {
            const atrule = data.atrules.getPtr(name).?;
            const root = if (atrule.prelude) |prelude| try c.tree(prelude) else none;
            const start: u32 = @intCast(c.descriptors.items.len);
            var descriptors: std.ArrayList(Entry) = .empty;
            try c.entries(&atrule.descriptors, &descriptors);
            try c.descriptors.appendSlice(c.gpa, descriptors.items);
            try c.atrules.append(c.gpa, .{
                .entry = .{ .name = name, .root = root },
                .start = start,
                .len = @intCast(descriptors.items.len),
            });
        }
        for (c.properties.items) |entry| {
            for (entry.name) |ch| assert(!std.ascii.isUpper(ch));
        }
    }

    fn stringLess(_: void, a: []const u8, b: []const u8) bool {
        return std.mem.lessThan(u8, a, b);
    }

    fn has(list: []const Entry, name: []const u8) bool {
        for (list) |entry| if (std.mem.eql(u8, entry.name, name)) return true;
        return false;
    }

    // every reference resolves, so the lexer never meets a missing definition
    fn validate(c: *const Compiled) !void {
        var missing: u32 = 0;
        for (c.nodes.items) |node| {
            const name = switch (node.tag) {
                .type, .property => node.text(c.text.items),
                else => continue,
            };
            const known = if (node.tag == .type)
                generic.find(name) != null or has(c.types.items, name)
            else
                has(c.properties.items, name);
            if (known) continue;
            const quote = if (node.tag == .property) "'" else "";
            std.debug.print("gen_grammar: no definition for <{s}{s}{s}>\n", .{
                quote, name, quote,
            });
            missing += 1;
        }
        if (missing > 0) fatal(
            "{d} references have no definition; add them to src/grammar/patch.json",
            .{missing},
        );
    }

    fn write(c: *Compiled, w: *Writer) !void {
        try w.writeAll(
            \\//! generated by tools/gen_grammar.zig from @webref/css and src/grammar/patch.json
            \\
            \\/// Every name and every span the trees point at.
            \\
        );
        // the names go into the text too, so every string is a span of one pool
        const lists = [_][]Entry{ c.types.items, c.properties.items, c.descriptors.items };
        var spans: std.ArrayList(u32) = .empty;
        for (lists) |list| for (list) |entry| try spans.append(c.gpa, try c.intern(entry.name));
        for (c.atrules.items) |atrule| try spans.append(c.gpa, try c.intern(atrule.entry.name));
        if (c.text.items.len >= 1 << 16 or c.nodes.items.len >= none16) {
            fatal("the grammar outgrew its 16-bit offsets", .{});
        }

        try w.print("pub const text = \"{f}\";\n", .{std.zig.fmtString(c.text.items)});
        try w.print(
            "/// The trees, a `u32` a node: `syntax.Node`'s tag, flags, len and data in 4, 4, 8 " ++
                "and 16 bits.\npub const nodes = [{d}]u32{{\n",
            .{c.nodes.items.len},
        );
        for (c.nodes.items, 0..) |node, i| {
            try w.print("{s}0x{x}", .{ if (i % 8 == 0) "    " else " ", compact(node) });
            try w.writeAll(if (i % 8 == 7 or i + 1 == c.nodes.items.len) ",\n" else ",");
        }
        try w.writeAll("};\n");
        var at: usize = 0;
        const titles = [_][]const u8{ "type", "property", "descriptor" };
        for (lists, titles) |list, title| {
            try w.print("/// Each name as its start << 8 | its length, by name.\n", .{});
            try writeWords(w, title, "_names", "u32", list.len, spans.items[at..], list, nameWord);
            try writeWords(w, title, "_roots", "u16", list.len, spans.items[at..], list, rootWord);
            at += list.len;
        }
        try w.print("pub const atrule_names = [{d}]u32{{", .{c.atrules.items.len});
        for (c.atrules.items, 0..) |atrule, i| {
            const word = nameWord(spans.items[at + i], atrule.entry);
            try w.print("{s}0x{x},", .{ separator(i), word });
        }
        try w.print(
            "\n}};\n/// `0xFFFF` for none.\npub const atrule_preludes = [{d}]u16{{",
            .{c.atrules.items.len},
        );
        for (c.atrules.items, 0..) |atrule, i| {
            try w.print("{s}0x{x},", .{ separator(i), rootWord(0, atrule.entry) });
        }
        try w.print(
            "\n}};\n/// The first descriptor << 8 | the descriptor count.\n" ++
                "pub const atrule_descriptors = [{d}]u32{{",
            .{c.atrules.items.len},
        );
        for (c.atrules.items, 0..) |atrule, i| {
            if (atrule.len >= 256) fatal("@{s} has too many descriptors", .{atrule.entry.name});
            try w.print("{s}0x{x},", .{ separator(i), atrule.start << 8 | atrule.len });
        }
        try w.writeAll("\n};\n");
        assert(at + c.atrules.items.len == spans.items.len);
    }

    const none16 = 0xFFFF;

    fn separator(i: usize) []const u8 {
        return if (i % 8 == 0) "\n    " else " ";
    }

    fn nameWord(span: u32, entry: Entry) u32 {
        if (entry.name.len >= 256) fatal("`{s}` is too long a name", .{entry.name});
        assert(span < 1 << 24);
        return span << 8 | @as(u32, @intCast(entry.name.len));
    }

    fn rootWord(_: u32, entry: Entry) u32 {
        assert(entry.root == none or entry.root < none16);
        return if (entry.root == none) none16 else entry.root;
    }

    fn writeWords(
        w: *Writer,
        title: []const u8,
        suffix: []const u8,
        int: []const u8,
        len: usize,
        spans: []const u32,
        list: []const Entry,
        word: fn (u32, Entry) u32,
    ) !void {
        try w.print("pub const {s}{s} = [{d}]{s}{{", .{ title, suffix, len, int });
        for (list, 0..) |entry, i| {
            try w.print("{s}0x{x},", .{ separator(i), word(spans[i], entry) });
        }
        try w.writeAll("\n};\n");
    }

    // a node in 32 bits; the generator checks each field fits
    fn compact(node: syntax.Node) u32 {
        const tag: u32 = @backingInt(node.tag);
        if (node.flags >= 16 or node.len >= 256 or node.data >= 1 << 16) {
            fatal("a {s} node does not fit 32 bits", .{@tagName(node.tag)});
        }
        assert(tag < 16);
        return tag | @as(u32, node.flags) << 4 | @as(u32, node.len) << 8 | node.data << 16;
    }
};
