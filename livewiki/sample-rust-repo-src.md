---
title: Sample Rust Repo Src
owner: generated
anchors:
  - packages/core/test/fixtures/sample-rust-repo/src/main.rs#log_startup
  - packages/core/test/fixtures/sample-rust-repo/src/main.rs#main
  - packages/core/test/fixtures/sample-rust-repo/src/models.rs#Request
  - packages/core/test/fixtures/sample-rust-repo/src/models.rs#Request.new
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

# Sample Rust Repo Src

`sample-rust-repo-src` is classified as test fixtures and supporting test data rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test that depends on this fixture.
- You need to see every exported symbol this fixture provides to tests.
- You are adding a new test that should reuse this fixture instead of duplicating it.

## How it fits

This module spans 3 files classified as test fixtures and supporting test data. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### main
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/main.rs#main -->

`fn main() {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/main.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### log_startup
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/main.rs#log_startup -->

`fn log_startup() {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/main.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Request
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/models.rs#Request -->

`pub struct Request {` is a class defined in `packages/core/test/fixtures/sample-rust-repo/src/models.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Request.new
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/models.rs#Request.new -->

`pub fn new(path: &str) -> Self {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/models.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Server
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server -->

`pub struct Server {` is a class defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Mode
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Mode -->

`pub enum Mode {` is a class defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Handler
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Handler -->

`pub trait Handler {` is a interface defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Server.new
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.new -->

`pub fn new(port: u16) -> Self {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Server.addr
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.addr -->

`pub fn addr(&self) -> String {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Server.handle
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.handle -->

`pub fn handle(&self, request: Request) {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### Server.process
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#Server.process -->

`fn process(&self, request: &Request) {` is a method defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### dispatch
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch -->

`fn dispatch(request: Request) {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

### dispatch_ref
<!-- lw:anchors packages/core/test/fixtures/sample-rust-repo/src/server.rs#dispatch_ref -->

`fn dispatch_ref(request: &Request) {` is a function defined in `packages/core/test/fixtures/sample-rust-repo/src/server.rs`, part of the test fixtures and supporting test data surface of `sample-rust-repo-src` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
