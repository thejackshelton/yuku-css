const std = @import("std");
const token = @import("token.zig");

/// Byte offsets into the source, `end` exclusive.
pub const Span = extern struct {
    start: u32,
    end: u32,
};

/// Text of the tree: below the source length a slice of the source, at or above it a slice of the pool.
pub const String = struct {
    start: u32,
    end: u32,

    pub const empty: String = .{ .start = 0, .end = 0 };
    /// Null, where a field may be.
    pub const none: String = .{ .start = std.math.maxInt(u32), .end = std.math.maxInt(u32) };
};

/// Index into `Tree.nodes`. `.null` marks an absent child.
pub const NodeIndex = enum(u32) { null = std.math.maxInt(u32), _ };

/// A child list, stored as a window into `Tree.extras`.
pub const IndexRange = struct {
    start: u32,
    len: u32,

    pub const empty: IndexRange = .{ .start = 0, .len = 0 };
    /// Null, where a field may be.
    pub const none: IndexRange = .{ .start = std.math.maxInt(u32), .len = 0 };
};

pub const Matcher = enum(u3) {
    none,
    equal,
    includes,
    dash,
    prefix,
    suffix,
    substring,

    pub const strings = [_]?[]const u8{ null, "=", "~=", "|=", "^=", "$=", "*=" };
};

/// css-tree's nodes, in the order of their fields there.
pub const NodeData = union(enum) {
    style_sheet: struct { children: IndexRange },
    /// A `/*! */` comment of the style sheet; css-tree keeps no other.
    comment: struct { value: String },
    cdo: struct {},
    cdc: struct {},
    atrule: struct { name: String, prelude: NodeIndex, block: NodeIndex },
    rule: struct { prelude: NodeIndex, block: NodeIndex },
    block: struct { children: IndexRange },
    declaration_list: struct { children: IndexRange },
    /// `important` is none for false, `important` for true, and the word after `!` otherwise.
    declaration: struct { important: String, property: String, value: NodeIndex },
    raw: struct { value: String },
    selector_list: struct { children: IndexRange },
    selector: struct { children: IndexRange },
    type_selector: struct { name: String },
    id_selector: struct { name: String },
    class_selector: struct { name: String },
    attribute_selector: struct { name: NodeIndex, matcher: Matcher, value: NodeIndex, flags: String },
    pseudo_class_selector: struct { name: String, children: IndexRange },
    pseudo_element_selector: struct { name: String, children: IndexRange },
    nesting_selector: struct {},
    /// The descendant combinator's name is a pooled `" "`, and it has no position in css-tree.
    combinator: struct { name: String },
    nth: struct { nth: NodeIndex, selector: NodeIndex },
    an_plus_b: struct { a: String, b: String },
    identifier: struct { name: String },
    string: struct { value: String },
    percentage: struct { value: String },
    operator: struct { value: String },
    value: struct { children: IndexRange },
    /// As written, sign and exponent included.
    number: struct { value: String },
    dimension: struct { value: String, unit: String },
    /// Without its `#`.
    hash: struct { value: String },
    /// Decoded, without `url(`, quotes and `)`.
    url: struct { value: String },
    function: struct { name: String, children: IndexRange },
    parentheses: struct { children: IndexRange },
    brackets: struct { children: IndexRange },
    unicode_range: struct { value: String },
    /// `right` is null for a lone number.
    ratio: struct { left: NodeIndex, right: NodeIndex },
    /// A pooled `" "` that css-tree places in an empty custom property value, with no position.
    white_space: struct { value: String },
};

pub const Tag = std.meta.Tag(NodeData);

pub const Node = struct {
    data: NodeData,
    span: Span,
};

pub const NodeList = std.MultiArrayList(Node);

pub const Message = enum(u8) {
    unexpected_input,
    selector_expected,
    identifier_expected,
    identifier_expected_function_found,
    identifier_or_asterisk_expected,
    name_expected,
    percent_sign_expected,
    vertical_line_expected,
    unexpected_end,
    attribute_operator_expected,
    equal_sign_expected,
    combinator_expected,
    number_sign_not_allowed,
    number_sign_expected,
    integer_expected,
    n_expected,
    hyphen_minus_expected,
    identifier_string_or_comma_expected,
    deep_expected,
    solidus_expected,
    ampersand_expected,
    full_stop_expected,
    nesting_too_deep,
    // `<Token> is expected`, as css-tree words it for each tag `eat` wants
    hash_expected,
    colon_expected,
    left_square_bracket_expected,
    right_square_bracket_expected,
    right_parenthesis_expected,
    left_curly_bracket_expected,
    right_curly_bracket_expected,
    at_keyword_expected,
    function_expected,
    string_expected,
    number_expected,
    percentage_expected,
    cdo_expected,
    cdc_expected,
    comment_expected,
    delim_expected,
    hex_or_identifier_expected,
    u_expected,
    plus_sign_delim_expected,
    plus_sign_expected,
    range_hyphen_minus_expected,
    hyphen_minus_or_hex_digit_expected,
    hex_digit_expected,
    hex_digit_or_question_mark_expected,
    too_many_hex_digits,
    too_many_question_marks,
    number_or_function_expected,
    // where the specs read an error that css-tree does not
    relative_selector_not_allowed,
    compound_selector_expected,
    type_selector_not_first,
    unterminated_comment,
    unterminated_string,
    newline_in_string,
    unterminated_url,
    bad_url,
    invalid_escape,

    /// css-tree's wording.
    pub fn text(message: Message) []const u8 {
        return switch (message) {
            .unexpected_input => "Unexpected input",
            .selector_expected => "Selector is expected",
            .identifier_expected => "Identifier is expected",
            .identifier_expected_function_found => "Identifier is expected but function found",
            .identifier_or_asterisk_expected => "Identifier or asterisk is expected",
            .name_expected => "Name is expected",
            .percent_sign_expected => "Percent sign is expected",
            .vertical_line_expected => "Vertical line is expected",
            .unexpected_end => "Unexpected end of input",
            .attribute_operator_expected => "Attribute selector (=, ~=, ^=, $=, *=, |=) is expected",
            .equal_sign_expected => "Equal sign is expected",
            .combinator_expected => "Combinator is expected",
            .number_sign_not_allowed => "Number sign is not allowed",
            .number_sign_expected => "Number sign is expected",
            .integer_expected => "Integer is expected",
            .n_expected => "N is expected",
            .hyphen_minus_expected => "HyphenMinus is expected",
            .identifier_string_or_comma_expected => "Identifier, string or comma is expected",
            .deep_expected => "Identifier \"deep\" is expected",
            .solidus_expected => "Delim \"/\" is expected",
            .ampersand_expected => "Delim \"&\" is expected",
            .full_stop_expected => "Delim \".\" is expected",
            .nesting_too_deep => "Nesting is too deep",
            .hash_expected => "Hash is expected",
            .colon_expected => "Colon is expected",
            .left_square_bracket_expected => "\"[\" is expected",
            .right_square_bracket_expected => "\"]\" is expected",
            .right_parenthesis_expected => "\")\" is expected",
            .left_curly_bracket_expected => "\"{\" is expected",
            .right_curly_bracket_expected => "\"}\" is expected",
            .at_keyword_expected => "At keyword is expected",
            .function_expected => "Function is expected",
            .string_expected => "String is expected",
            .number_expected => "Number is expected",
            .percentage_expected => "Percentage is expected",
            .cdo_expected => "CDO is expected",
            .cdc_expected => "CDC is expected",
            .comment_expected => "Comment is expected",
            .delim_expected => "Delim is expected",
            .hex_or_identifier_expected => "Hex or identifier is expected",
            .u_expected => "Identifier \"u\" is expected",
            .plus_sign_delim_expected => "Delim \"+\" is expected",
            .plus_sign_expected => "Plus sign is expected",
            .range_hyphen_minus_expected => "Hyphen minus is expected",
            .hyphen_minus_or_hex_digit_expected => "Hyphen minus or hex digit is expected",
            .hex_digit_expected => "Hex digit is expected",
            .hex_digit_or_question_mark_expected => "Hex digit or question mark is expected",
            .too_many_hex_digits => "Too many hex digits",
            .too_many_question_marks => "Too many question marks",
            // css-tree's typo, kept so messages match
            .number_or_function_expected => "Number of function is expected",
            .relative_selector_not_allowed => "Relative selector is not allowed here",
            .compound_selector_expected => "Compound selector is expected",
            .type_selector_not_first => "Type selector must come first in a compound selector",
            .unterminated_comment => "Unterminated comment",
            .unterminated_string => "Unterminated string",
            .newline_in_string => "Newline in string",
            .unterminated_url => "Unterminated url",
            .bad_url => "Unexpected character in url",
            .invalid_escape => "Invalid escape",
        };
    }
};

pub const Diagnostic = struct {
    message: Message,
    span: Span,
};

/// A parsed tree. All memory lives in one arena, so `deinit()` frees everything at once.
pub const Tree = struct {
    root: NodeIndex = .null,
    nodes: NodeList = .empty,
    /// Child lists of all nodes, resolved with `extra()`.
    extras: std.ArrayList(NodeIndex) = .empty,
    diagnostics: std.ArrayList(Diagnostic) = .empty,
    /// The tokens of the source, when asked for.
    tokens: []const token.Token = &.{},
    /// Where each comment of the source starts and ends, in order.
    comments: []const Span = &.{},
    source: []const u8,
    strings: StringPool,
    arena: std.heap.ArenaAllocator,

    pub fn init(child_allocator: std.mem.Allocator, source: []const u8) Tree {
        return .{
            .source = source,
            .strings = .{ .source = source },
            .arena = .init(child_allocator),
        };
    }

    pub fn deinit(tree: *const Tree) void {
        tree.arena.deinit();
    }

    pub inline fn allocator(tree: *Tree) std.mem.Allocator {
        return tree.arena.allocator();
    }

    pub inline fn data(tree: *const Tree, index: NodeIndex) NodeData {
        std.debug.assert(index != .null);
        return tree.nodes.items(.data)[@backingInt(index)];
    }

    pub inline fn span(tree: *const Tree, index: NodeIndex) Span {
        std.debug.assert(index != .null);
        return tree.nodes.items(.span)[@backingInt(index)];
    }

    pub inline fn extra(tree: *const Tree, range: IndexRange) []const NodeIndex {
        std.debug.assert(range.start + range.len <= tree.extras.items.len);
        return tree.extras.items[range.start..][0..range.len];
    }

    pub inline fn string(tree: *const Tree, id: String) []const u8 {
        return tree.strings.get(id);
    }

    pub inline fn addNode(tree: *Tree, node_data: NodeData, node_span: Span) error{OutOfMemory}!NodeIndex {
        std.debug.assert(node_span.start <= node_span.end);
        const index: NodeIndex = @fromBackingInt(@intCast(tree.nodes.len));
        const entry: Node = .{ .data = node_data, .span = node_span };
        if (tree.nodes.len < tree.nodes.capacity) {
            tree.nodes.appendAssumeCapacity(entry);
        } else {
            try tree.nodes.append(tree.allocator(), entry);
        }
        return index;
    }

    pub inline fn addExtra(tree: *Tree, children: []const NodeIndex) error{OutOfMemory}!IndexRange {
        const start: u32 = @intCast(tree.extras.items.len);
        if (tree.extras.items.len + children.len <= tree.extras.capacity) {
            tree.extras.appendSliceAssumeCapacity(children);
        } else {
            try tree.extras.appendSlice(tree.allocator(), children);
        }
        return .{ .start = start, .len = @intCast(children.len) };
    }

    /// Interns text that is not in the source, such as a decoded string.
    pub fn addString(tree: *Tree, str: []const u8) error{OutOfMemory}!String {
        return tree.strings.add(tree.allocator(), str);
    }
};

pub const StringPool = struct {
    source: []const u8,
    extra: std.ArrayList(u8) = .empty,
    dedup: std.StringHashMapUnmanaged(String) = .empty,

    pub fn get(pool: *const StringPool, id: String) []const u8 {
        std.debug.assert(id.start != String.none.start);
        if (id.start < pool.source.len) return pool.source[id.start..id.end];
        const base: u32 = @intCast(pool.source.len);
        return pool.extra.items[id.start - base .. id.end - base];
    }

    pub fn add(pool: *StringPool, gpa: std.mem.Allocator, str: []const u8) error{OutOfMemory}!String {
        if (str.len == 0) return .empty;
        if (pool.dedup.get(str)) |existing| return existing;
        const base: u32 = @intCast(pool.source.len);
        const start: u32 = base + @as(u32, @intCast(pool.extra.items.len));
        try pool.extra.appendSlice(gpa, str);
        const id: String = .{ .start = start, .end = base + @as(u32, @intCast(pool.extra.items.len)) };
        try pool.dedup.put(gpa, try gpa.dupe(u8, str), id);
        return id;
    }
};

comptime {
    std.debug.assert(@sizeOf(NodeData) == 24);
    std.debug.assert(@sizeOf(Node) == 32);
}
