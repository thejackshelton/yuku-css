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
    generated.addCopyFileToSource(b.addRunArtifact(gen_decoder).captureStdOut(.{}), "src/decode.js");
    b.getInstallStep().dependOn(&generated.step);

    const test_step = b.step("test", "Run the Zig tests");
    test_step.dependOn(&b.addRunArtifact(b.addTest(.{ .root_module = css })).step);
}
