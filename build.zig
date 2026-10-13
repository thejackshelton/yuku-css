const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const css = b.addModule("yuku-css", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    const wasm = b.addExecutable(.{
        .name = "yuku-css",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/wasm.zig"),
            .target = b.resolveTargetQuery(.{
                .cpu_arch = .wasm32,
                .os_tag = .freestanding,
                .cpu_model = .{ .explicit = &std.Target.wasm.cpu.mvp },
            }),
            // small saves 20 kB at the cost of 14% of the speed
            .optimize = .ReleaseFast,
            .strip = true,
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    b.installArtifact(wasm);

    // the grammar's Zig, for the tools that compile its data and for its tests
    const host_css = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
    });
    const grammar = b.createModule(.{
        .root_source_file = b.path("src/grammar/root.zig"),
        .target = b.graph.host,
        .optimize = optimize,
        .imports = &.{.{ .name = "css", .module = host_css }},
    });
    const gen_grammar = b.addExecutable(.{
        .name = "gen_grammar",
        .root_module = b.createModule(.{
            .root_source_file = b.path("tools/gen_grammar.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "grammar", .module = grammar }},
        }),
    });
    const run_gen_grammar = b.addRunArtifact(gen_grammar);
    run_gen_grammar.addFileArg(b.path("node_modules/@webref/css/css.json"));
    run_gen_grammar.addFileArg(b.path("src/grammar/patch.json"));
    const grammar_data = b.createModule(.{
        .root_source_file = run_gen_grammar.captureStdOut(.{ .basename = "grammar_data.zig" }),
    });

    // `yuku-css/lexer`, a module of its own so the parser does not carry the grammar data
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_model = .{ .explicit = &std.Target.wasm.cpu.mvp },
    });
    const lexer_wasm = b.addExecutable(.{
        .name = "yuku-css-lexer",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/grammar/wasm.zig"),
            .target = wasm_target,
            // small saves 28 kB, 7 kB gzipped, at the cost of 38% of the matching speed
            .optimize = .ReleaseFast,
            .strip = true,
            .imports = &.{
                .{ .name = "grammar_data", .module = grammar_data },
                .{ .name = "css", .module = b.createModule(.{
                    .root_source_file = b.path("src/root.zig"),
                    .target = wasm_target,
                    .optimize = .ReleaseFast,
                }) },
            },
        }),
    });
    lexer_wasm.entry = .disabled;
    lexer_wasm.rdynamic = true;
    b.installArtifact(lexer_wasm);

    const gen_decoder = b.addExecutable(.{
        .name = "gen_decoder",
        .root_module = b.createModule(.{
            .root_source_file = b.path("tools/gen_decoder.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "yuku-css", .module = b.createModule(.{
                .root_source_file = b.path("src/root.zig"),
                .target = b.graph.host,
                .optimize = optimize,
            }) }},
        }),
    });
    const generated = b.addUpdateSourceFiles();
    generated.addCopyFileToSource(
        b.addRunArtifact(gen_decoder).captureStdOut(.{}),
        "src/decode.js",
    );
    const gen_lexer_js = b.addExecutable(.{
        .name = "gen_lexer_js",
        .root_module = b.createModule(.{
            .root_source_file = b.path("tools/gen_lexer_js.zig"),
            .target = b.graph.host,
            .optimize = optimize,
            .imports = &.{.{ .name = "grammar", .module = grammar }},
        }),
    });
    const lexer_js = b.addRunArtifact(gen_lexer_js).captureStdOut(.{});
    generated.addCopyFileToSource(lexer_js, "src/lexer/tables.ts");
    b.getInstallStep().dependOn(&generated.step);

    const test_step = b.step("test", "Run the Zig tests");
    test_step.dependOn(&b.addRunArtifact(b.addTest(.{ .root_module = css })).step);
    const grammar_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/grammar/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "grammar_data", .module = grammar_data },
            .{ .name = "css", .module = css },
        },
    }) });
    test_step.dependOn(&b.addRunArtifact(grammar_tests).step);
}
