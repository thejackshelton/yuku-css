const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const css = b.addModule("yuku-css", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    const wasm = b.addExecutable(.{ .name = "yuku-css", .root_module = b.createModule(.{
        .root_source_file = b.path("src/wasm.zig"),
        .target = b.resolveTargetQuery(.{
            .cpu_arch = .wasm32,
            .os_tag = .freestanding,
            .cpu_model = .{ .explicit = &std.Target.wasm.cpu.mvp },
        }),
        .optimize = .ReleaseFast,
        .strip = true,
    }) });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    b.installArtifact(wasm);

    const test_step = b.step("test", "Run the Zig tests");
    test_step.dependOn(&b.addRunArtifact(b.addTest(.{ .root_module = css })).step);
}
