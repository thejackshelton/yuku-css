const std = @import("std");

/// Byte offsets into the source, `end` exclusive.
pub const Span = struct {
    start: u32,
    end: u32,
};

pub const NodeIndex = enum(u32) {
    null = std.math.maxInt(u32),
    _,
};

/// A run of `Tree.extra`.
pub const NodeList = struct {
    start: u32 = 0,
    len: u32 = 0,
};

pub const Combinator = enum {
    descendant,
    child,
    next_sibling,
    subsequent_sibling,
    column,

    pub const strings = [_][]const u8{ " ", ">", "+", "~", "||" };
};

/// Field types map to the transfer format: `NodeIndex` is a node or null, `NodeList` a
/// list of nodes, `Span` a slice of the source, `?Span` one or null, `bool`, and enums.
pub const Data = union(enum) {
    style_sheet: struct { children: NodeList },
    /// `prelude` is a `selector_list`, or a `raw` in a keyframes block or when the selector does not parse.
    rule: struct { prelude: NodeIndex, block: NodeIndex },
    at_rule: struct { name: Span, prelude: NodeIndex, block: NodeIndex },
    block: struct { children: NodeList },
    declaration: struct { property: Span, value: NodeIndex, important: bool },
    raw: struct { value: Span },
    selector_list: struct { children: NodeList },
    complex_selector: struct { children: NodeList },
    compound_selector: struct { children: NodeList },
    combinator: struct { name: Combinator },
    type_selector: struct { namespace: ?Span, name: Span },
    id_selector: struct { name: Span },
    class_selector: struct { name: Span },
    attribute_selector: struct { namespace: ?Span, name: Span, matcher: ?Span, value: ?Span, modifier: ?Span },
    pseudo_class_selector: struct { name: Span, argument: NodeIndex },
    pseudo_element_selector: struct { name: Span, argument: NodeIndex },
    nesting_selector: struct {},
    /// The argument of `:nth-child()` and its kin: `An+B`, then the selector after `of`.
    nth: struct { nth: Span, selector: NodeIndex },
};

pub const Tag = std.meta.Tag(Data);

pub const Node = struct {
    data: Data,
    span: Span,
};

pub const Message = enum {
    unclosed_comment,
    unclosed_string,
    unclosed_block,
    unexpected_close,
    expected_at_rule_name,
    expected_property,
    expected_colon,
    declaration_outside_rule,
    expected_keyframe_rule,
    expected_selector,
    expected_name,
    expected_attribute_end,
    invalid_attribute,
    invalid_nth,
    unexpected_in_selector,
    nesting_too_deep,

    pub fn text(message: Message) []const u8 {
        return switch (message) {
            .unclosed_comment => "Unclosed comment",
            .unclosed_string => "Unclosed string",
            .unclosed_block => "Unclosed block",
            .unexpected_close => "Unexpected '}'",
            .expected_at_rule_name => "Expected an at-rule name after '@'",
            .expected_property => "Expected a property name",
            .expected_colon => "Expected ':' after the property name",
            .declaration_outside_rule => "Declaration outside of a rule",
            .expected_keyframe_rule => "Expected a keyframe rule",
            .expected_selector => "Expected a selector",
            .expected_name => "Expected a name",
            .expected_attribute_end => "Expected ']'",
            .invalid_attribute => "Invalid attribute selector",
            .invalid_nth => "Invalid An+B expression",
            .unexpected_in_selector => "Unexpected character in selector",
            .nesting_too_deep => "Nesting is too deep",
        };
    }
};

pub const Diagnostic = struct {
    message: Message,
    span: Span,
};

pub const Tree = struct {
    source: []const u8,
    nodes: []const Node,
    extra: []const NodeIndex,
    root: NodeIndex,
    diagnostics: []const Diagnostic,
    arena: std.heap.ArenaAllocator,

    pub fn deinit(tree: *Tree) void {
        tree.arena.deinit();
    }

    pub fn node(tree: *const Tree, index: NodeIndex) Node {
        return tree.nodes[@backingInt(index)];
    }

    pub fn list(tree: *const Tree, range: NodeList) []const NodeIndex {
        return tree.extra[range.start..][0..range.len];
    }

    pub fn string(tree: *const Tree, span: Span) []const u8 {
        return tree.source[span.start..span.end];
    }
};
