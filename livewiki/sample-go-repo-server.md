---
title: Sample Go Repo Server
owner: generated
anchors:
  - packages/core/test/fixtures/sample-go-repo/server/server.go#NewServer
  - packages/core/test/fixtures/sample-go-repo/server/server.go#Runner
  - packages/core/test/fixtures/sample-go-repo/server/server.go#Server
  - packages/core/test/fixtures/sample-go-repo/server/server.go#Server.Addr
  - packages/core/test/fixtures/sample-go-repo/server/server.go#Server.Start
  - packages/core/test/fixtures/sample-go-repo/server/server.go#listen
---

# Sample Go Repo Server

`sample-go-repo-server` is classified as test fixtures and supporting test data rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test that depends on this fixture.
- You need to see every exported symbol this fixture provides to tests.
- You are adding a new test that should reuse this fixture instead of duplicating it.

## How it fits

This module spans 1 file classified as test fixtures and supporting test data. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### Server
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#Server -->

`type Server struct {` is a class defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

### Runner
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#Runner -->

`type Runner interface {` is a interface defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

### NewServer
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#NewServer -->

`func NewServer(port int) *Server {` is a function defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

### Server.Addr
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#Server.Addr -->

`func (s *Server) Addr() string {` is a method defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

### Server.Start
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#Server.Start -->

`func (s Server) Start() error {` is a method defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

### listen
<!-- lw:anchors packages/core/test/fixtures/sample-go-repo/server/server.go#listen -->

`func listen(port int) error {` is a function defined in `packages/core/test/fixtures/sample-go-repo/server/server.go`, part of the test fixtures and supporting test data surface of `sample-go-repo-server` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
