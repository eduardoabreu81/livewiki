---
title: Fixture Server
owner: generated
anchors:
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java#Handler
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java#Handler.handle
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Mode.java#Mode
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.Server
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.addr
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.dispatch
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.handle
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.listen
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.process
  - packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.start
---

# Fixture Server

`fixture-server` is classified as test fixtures and supporting test data rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test that depends on this fixture.
- You need to see every exported symbol this fixture provides to tests.
- You are adding a new test that should reuse this fixture instead of duplicating it.

## How it fits

This module spans 3 files classified as test fixtures and supporting test data. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### Handler
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java#Handler -->

`public interface Handler {` is a interface defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Handler.handle
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java#Handler.handle -->

`void handle(List<Item> items);` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Handler.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Mode
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Mode.java#Mode -->

`public enum Mode {` is a class defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Mode.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server -->

`public class Server implements Handler {` is a class defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.Server
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.Server -->

`public Server(int port) {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.start
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.start -->

`public void start() {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.addr
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.addr -->

`public String addr() {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.handle
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.handle -->

`@Override` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.dispatch
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.dispatch -->

`private void dispatch(List<Item> items) {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.listen
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.listen -->

`private static void listen(int port) {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

### Server.process
<!-- lw:anchors packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java#Server.process -->

`private static void process(Item item) {` is a method defined in `packages/core/test/fixtures/sample-java-repo/src/main/java/com/fixture/server/Server.java`, part of the test fixtures and supporting test data surface of `fixture-server` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
