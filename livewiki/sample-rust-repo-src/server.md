---
title: Sample Rust Repo Src Server
owner: generated
anchors:
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Handler
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Mode
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.addr
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.handle
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.new
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.process
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch
  - packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch_ref
---

# Sample Rust Repo Src Server

This page documents the test fixtures and supporting test data under `sample-rust-repo-src/server` — reference material, not part of the shipped product's runtime code.

## When to use this page

- You are debugging a failing test that depends on this fixture.
- You need to see every function and value this fixture provides to tests.
- You are adding a new test that should reuse this fixture instead of duplicating it.

## How it fits

This area spans 1 file of test fixtures and supporting test data. They are documented here for reference and are not linked from the main product pages.

## Reference

### Server
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server -->

`pub struct Server {` is a class defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Mode
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Mode -->

`pub enum Mode {` is a class defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Handler
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Handler -->

`pub trait Handler {` is a interface defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Server.new
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.new -->

`pub fn new(port: u16) -> Self {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Server.addr
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.addr -->

`pub fn addr(&self) -> String {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Server.handle
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.handle -->

`pub fn handle(&self, request: Request) {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### Server.process
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.process -->

`fn process(&self, request: &Request) {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### dispatch
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch -->

`fn dispatch(request: Request) {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.

### dispatch_ref
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch_ref -->

`fn dispatch_ref(request: &Request) {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of this area's test fixtures and supporting test data — not part of the product's runtime behavior.
