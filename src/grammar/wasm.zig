// the module behind `yuku-css/lexer`, instantiated with no imports; its lexers live in its memory
// for the life of the instance

const std = @import("std");
const css = @import("css");
const syntax = @import("syntax.zig");
const generic = @import("generic.zig");
const defs_ = @import("defs.zig");
const lexer_ = @import("lexer.zig");
const match_ = @import("match.zig");
const validate_ = @import("validate.zig");

const assert = std.debug.assert;
const gpa = std.heap.wasm_allocator;
const Lexer = lexer_.Lexer;
const none = lexer_.none;

var defs: defs_.Defs = .{};
var lexers: std.ArrayList(*Lexer) = .empty;
var matcher: match_.Matcher = .{ .gpa = gpa };
var tokens: css.token.TokenList = .empty;
var failure: syntax.Failure = .{ .message = .unexpected_input, .offset = 0 };
// the value a match reads and the words it writes, kept between calls
var input: std.ArrayList(u8) = .empty;
var output: std.ArrayList(u32) = .empty;
var given: std.ArrayList(css.token.Token) = .empty;

/// Room for `len` bytes of the next value to match, or 0 when out of memory.
export fn inputBuffer(len: u32) u32 {
    input.ensureTotalCapacity(gpa, len) catch return 0;
    assert(input.capacity >= len);
    return @intFromPtr(input.items.ptr);
}

export fn alloc(len: u32) [*]u8 {
    return (gpa.alloc(u8, len) catch @trap()).ptr;
}

export fn free(ptr: [*]u8, len: u32) void {
    gpa.free(ptr[0..len]);
}

/// Definition syntax as a tree, behind a u32 length, or 0 when out of memory. The first word is
/// 0 and the node count, then the nodes, or 1 and a `syntax.Failure`.
export fn parseSyntax(ptr: [*]const u8, len: u32) u32 {
    const out = parseSyntaxBuffer(ptr[0..len]) catch return 0;
    return @intFromPtr(out.ptr);
}

fn parseSyntaxBuffer(source: []const u8) ![]u8 {
    assert(source.len < std.math.maxInt(u32));
    var nodes: std.ArrayList(syntax.Node) = .empty;
    defer nodes.deinit(gpa);
    var why: syntax.Failure = undefined;
    syntax.parse(gpa, source, 0, &nodes, &why) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.Syntax => {
            const out = try prefixed(4 * 5);
            const words: [5]u32 = .{ 1, @backingInt(why.message), why.char, why.offset, why.base };
            @memcpy(out[4..], std.mem.sliceAsBytes(&words));
            return out;
        },
    };
    assert(nodes.items.len > 0);
    const bytes = std.mem.sliceAsBytes(nodes.items);
    const out = try prefixed(8 + bytes.len);
    std.mem.writeInt(u32, out[4..8], 0, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(nodes.items.len), .little);
    @memcpy(out[12..], bytes);
    return out;
}

// the length prefix tells the host how much to free
fn prefixed(size: usize) ![]u8 {
    assert(size >= 4);
    const out = try gpa.alloc(u8, 4 + size);
    assert(@intFromPtr(out.ptr) % 4 == 0);
    std.mem.writeInt(u32, out[0..4], @intCast(size), .little);
    return out;
}

/// A new lexer, over the compiled grammar when `builtin` is set, or `none` when out of memory.
export fn createLexer(builtin: u32, generic_types: u32) u32 {
    const l = gpa.create(Lexer) catch return none;
    l.* = Lexer.init(gpa, &defs, builtin != 0, generic_types != 0) catch {
        gpa.destroy(l);
        return none;
    };
    lexers.append(gpa, l) catch {
        l.deinit();
        gpa.destroy(l);
        return none;
    };
    assert(lexers.items.len > 0);
    return @intCast(lexers.items.len - 1);
}

fn lexerAt(id: u32) *Lexer {
    assert(id < lexers.items.len);
    return lexers.items[id];
}

/// Defines what `kind` names from the source at `ptr`: the name, the at-rule's name, then the
/// syntax. Returns the descriptor, or `none` with `failureWord` saying why.
export fn define(
    id: u32,
    kind: u32,
    ptr: [*]const u8,
    name_len: u32,
    atrule_len: u32,
    syntax_len: u32,
) u32 {
    const name = ptr[0..name_len];
    const atrule = ptr[name_len..][0..atrule_len];
    const source = ptr[name_len + atrule_len ..][0..syntax_len];
    return lexerAt(id).define(
        @fromBackingInt(@intCast(kind)),
        name,
        atrule,
        source,
        &failure,
    ) catch |err| {
        if (err == error.OutOfMemory) failure = .{ .message = .too_large, .offset = 0 };
        return none;
    };
}

/// Declares an at-rule with no prelude, so the at-rule is known.
export fn declareAtrule(id: u32, ptr: [*]const u8, len: u32) u32 {
    _ = lexerAt(id).declare(ptr[0..len]) catch return 0;
    return 1;
}

/// The last failure of `define` or `setCssWide`: the message, the character, the offset, the base.
export fn failureWord(i: u32) u32 {
    assert(i < 4);
    return switch (i) {
        0 => @backingInt(failure.message),
        1 => failure.char,
        2 => failure.offset,
        else => failure.base,
    };
}

/// Sets a unit group from the newline-separated units at `ptr`.
export fn setUnits(id: u32, group: u32, ptr: [*]const u8, len: u32) u32 {
    var list: std.ArrayList([]const u8) = .empty;
    defer list.deinit(gpa);
    var it = std.mem.splitScalar(u8, ptr[0..len], '\n');
    while (it.next()) |unit| if (unit.len > 0) list.append(gpa, unit) catch return 0;
    lexerAt(id).setUnits(group, list.items) catch return 0;
    return 1;
}

/// Sets the CSS-wide keywords from the definition syntax at `ptr`.
export fn setCssWide(id: u32, ptr: [*]const u8, len: u32) u32 {
    lexerAt(id).setCssWide(ptr[0..len]) catch return 0;
    return 1;
}

/// The descriptor of a type (0), property (1), at-rule prelude (2) or at-rule descriptor (3) named
/// by the source at `ptr`, the name and then the at-rule's name. `none` when it is unknown; for a
/// prelude `none - 1` when the at-rule takes none, for a descriptor `none - 1` when the at-rule
/// has no descriptors and `none - 2` when it lacks this one.
export fn find(id: u32, kind: u32, ptr: [*]const u8, name_len: u32, atrule_len: u32) u32 {
    const l = lexerAt(id);
    const name = ptr[0..name_len];
    return switch (kind) {
        0 => l.findType(name),
        1 => l.findProperty(name),
        2 => l.findAtrule(name),
        3 => @backingInt(l.findDescriptor(ptr[name_len..][0..atrule_len], name)),
        else => none,
    };
}

/// A descriptor's tree root, `none` for a generic type.
export fn descriptorRoot(id: u32, descriptor: u32) u32 {
    return lexerAt(id).descriptor(descriptor).root;
}

/// Matches the first `len` bytes of the input buffer against a descriptor, after the CSS-wide
/// keywords when `css_wide` is set. The words written, valid until the next match: the status, the
/// iterations, the token count, the token after the longest match, its start and end, the bad
/// reference, whether the CSS-wide keywords matched, where the first token starts, the entry
/// count, then each entry as its kind, definition node, token start and token end. 0 when out of
/// memory.
export fn match(id: u32, descriptor: u32, css_wide: u32, len: u32) u32 {
    assert(len <= input.capacity);
    const source = input.items.ptr[0..len];
    tokens.clearRetainingCapacity();
    css.tokenize(gpa, &tokens, source) catch return 0;
    const view: generic.Tokens = .{
        .source = source,
        .list = tokens.items,
        .first = generic.bomLen(source),
    };
    matchWords(lexerAt(id), descriptor, css_wide != 0, view) catch return 0;
    return @intFromPtr(output.items.ptr);
}

/// Room for `count` tokens of the next `matchTokens`, each an end and a tag as
/// `css.token.Token`, or 0 when out of memory.
export fn tokenBuffer(count: u32) u32 {
    given.ensureTotalCapacity(gpa, count) catch return 0;
    assert(given.capacity >= count);
    return @intFromPtr(given.items.ptr);
}

/// `match`, over `count` tokens the host wrote to the token buffer, as css-tree matches the
/// tokens it prints a tree to, rather than tokens read from the text.
export fn matchTokens(id: u32, descriptor: u32, css_wide: u32, len: u32, count: u32) u32 {
    assert(len <= input.capacity);
    assert(count <= given.capacity);
    const list = given.items.ptr[0..count];
    var previous: u32 = 0;
    for (list) |t| {
        if (t.end > len or t.end < previous) return 0;
        previous = t.end;
    }
    const view: generic.Tokens = .{ .source = input.items.ptr[0..len], .list = list, .first = 0 };
    matchWords(lexerAt(id), descriptor, css_wide != 0, view) catch return 0;
    return @intFromPtr(output.items.ptr);
}

const header_words = 10;

fn matchWords(l: *Lexer, descriptor: u32, css_wide: bool, view: generic.Tokens) !void {
    assert(descriptor < l.descriptors.items.len);
    assert(view.first <= view.source.len);
    var result: match_.Result = undefined;
    var wide = false;
    for (0..view.len()) |i| {
        const index: u32 = @intCast(i);
        if (view.tag(index) == .function and std.ascii.eqlIgnoreCase(view.text(index), "var(")) {
            result = .{ .status = .has_var, .iterations = 0, .longest = 0, .top = none };
            break;
        }
    } else if (css_wide) {
        result = try matcher.run(l, view, l.css_wide);
        wide = result.status == .match;
    }
    if (!wide and result.status != .has_var) {
        result = try matcher.run(l, view, try l.graphOf(descriptor, false));
    }

    var count: u32 = 0;
    var at = result.top;
    while (at != none and matcher.cell(at).entry != .stub) : (at = matcher.cell(at).prev) {
        count += 1;
    }
    output.clearRetainingCapacity();
    try output.resize(gpa, header_words + 4 * count);
    const words = output.items;
    const has_longest = result.longest < view.len();
    words[0..header_words].* = .{
        @backingInt(result.status),
        result.iterations,
        view.len(),
        result.longest,
        if (has_longest) view.start(result.longest) else 0,
        if (has_longest) view.list[result.longest].end else 0,
        result.reference,
        @intFromBool(wide),
        view.first,
        count,
    };
    var i = count;
    at = result.top;
    while (i > 0) {
        i -= 1;
        const c = matcher.cell(at);
        const entry = words[header_words + 4 * i ..][0..4];
        const has_token = c.entry == .token;
        assert(!has_token or c.token < 1 << 24);
        entry.* = .{
            @as(u32, @backingInt(c.entry)) | (if (has_token) c.token << 8 else 0),
            c.syntax,
            if (has_token) view.start(c.token) else 0,
            if (has_token) view.list[c.token].end else 0,
        };
        at = c.prev;
    }
    assert(at == 0 or count == 0);
}

var entries: std.ArrayList(u32) = .empty;
var lowered: std.ArrayList(u8) = .empty;

/// Parses the first `len` bytes of the input buffer as a style sheet and matches every declaration,
/// as `validate.zig` lays the result out, valid until the next call. 0 when out of memory.
export fn validate(id: u32, len: u32) u32 {
    assert(len <= input.capacity);
    const source = input.items.ptr[0..len];
    const l = lexerAt(id);
    validate_.validate(gpa, l, &matcher, source, &output, &entries, &lowered) catch return 0;
    assert(output.items.len >= validate_.header_words);
    return @intFromPtr(output.items.ptr);
}

/// Every definition the lexer holds, behind a u32 length: the count, then for each its kind,
/// descriptor, name length and at-rule name length, then the names and at-rule names in order.
export fn names(id: u32) u32 {
    const out = namesBuffer(lexerAt(id)) catch return 0;
    return @intFromPtr(out.ptr);
}

const Listing = struct {
    entries: std.ArrayList(u32) = .empty,
    text: std.ArrayList(u8) = .empty,

    fn visit(
        self: *Listing,
        kind: lexer_.Kind,
        name: []const u8,
        atrule: []const u8,
        descriptor: u32,
    ) !void {
        assert(name.len < std.math.maxInt(u32));
        assert(atrule.len < std.math.maxInt(u32));
        try self.entries.appendSlice(
            gpa,
            &.{ @backingInt(kind), descriptor, @intCast(name.len), @intCast(atrule.len) },
        );
        try self.text.appendSlice(gpa, name);
        try self.text.appendSlice(gpa, atrule);
    }
};

fn namesBuffer(l: *Lexer) ![]u8 {
    assert(l.descriptors.items.len > 0);
    var listing: Listing = .{};
    defer listing.entries.deinit(gpa);
    defer listing.text.deinit(gpa);
    try l.each(&listing, Listing.visit);
    const count = listing.entries.items.len / 4;
    const out = try prefixed(4 + 4 * listing.entries.items.len + listing.text.items.len);
    std.mem.writeInt(u32, out[4..8], @intCast(count), .little);
    @memcpy(
        out[8..][0 .. 4 * listing.entries.items.len],
        std.mem.sliceAsBytes(listing.entries.items),
    );
    @memcpy(out[8 + 4 * listing.entries.items.len ..], listing.text.items);
    assert(listing.entries.items.len % 4 == 0);
    return out;
}

var layout: [8]u32 = undefined;

/// Where the compiled trees, the compiled text, the runtime trees and the runtime text are, and how
/// long each is, as eight words at the address returned; it allocates nothing, so a view of memory
/// taken before it stays valid.
export fn defsLayout() [*]const u32 {
    layout = .{
        @intFromPtr(defs_.builtin_nodes.ptr),
        @intCast(defs_.builtin_nodes.len),
        @intFromPtr(defs_.builtin_text.ptr),
        @intCast(defs_.builtin_text.len),
        @intFromPtr(defs.nodes.items.ptr),
        @intCast(defs.nodes.items.len),
        @intFromPtr(defs.chars.items.ptr),
        @intCast(defs.chars.items.len),
    };
    assert(layout[1] > 0);
    return &layout;
}
