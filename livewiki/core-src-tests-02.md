---
title: Core Src Tests 02
owner: generated
anchors:
  - packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm
  - packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm.generate
  - packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm
  - packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm.generate
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate
  - packages/core/src/batch-stage5.test.ts#TopicMockLlm
  - packages/core/src/batch-stage5.test.ts#TopicMockLlm.generate
  - packages/core/src/batch-stage5.test.ts#countStage5Tasks
  - packages/core/src/batch-stage5.test.ts#fileExists
  - packages/core/src/batch-stage5.test.ts#findTopicPagePath
  - packages/core/src/batch-stage5.test.ts#isTopicRefineRequest
  - packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections
  - packages/core/src/batch-stage5.test.ts#makeRelaxedFlowPage
  - packages/core/src/batch-stage5.test.ts#makeRelaxedTopicPage
  - packages/core/src/batch-stage5.test.ts#makeStrictFailingFlowPage
  - packages/core/src/batch-stage5.test.ts#makeStrictFailingTopicPage
  - packages/core/src/batch-stage5.test.ts#makeTopicPage
  - packages/core/src/batch-stage5.test.ts#makeValidPage
  - packages/core/src/batch-stage5.test.ts#parseClosedKeys
  - packages/core/src/batch-stage5.test.ts#parseFlowPrompt
  - packages/core/src/batch-stage5.test.ts#parseTopicPrompt
  - packages/core/src/batch-stage5.test.ts#readLatestRunTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#readTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#readTopicTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#topicFrontmatter
  - packages/core/src/batch-stage5.test.ts#topicRelatedPages
  - packages/core/src/batch-stage5.test.ts#writeFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeHubAndSpokeTopicRepo
  - packages/core/src/batch-stage5.test.ts#writeTopicEligibleRepo
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate
  - packages/core/src/batch-status.test.ts#OneShotMockLlm
  - packages/core/src/batch-status.test.ts#OneShotMockLlm.generate
  - packages/core/src/batch-status.test.ts#ValidMockLlm
  - packages/core/src/batch-status.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-status.test.ts#seedLegacyCheckpoint
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-surgical-repair.test.ts#makeEmptySectionPage
  - packages/core/src/batch-surgical-repair.test.ts#makeFlowPage
  - packages/core/src/batch-surgical-repair.test.ts#makeFlowPagePurposeBullets
  - packages/core/src/batch-surgical-repair.test.ts#makeTopicPage
  - packages/core/src/batch-surgical-repair.test.ts#makeTopicPageEmptyChangeMap
  - packages/core/src/batch-surgical-repair.test.ts#makeValidPage
  - packages/core/src/batch-surgical-repair.test.ts#parseClosedKeys
  - packages/core/src/batch-surgical-repair.test.ts#parseFlowPrompt
  - packages/core/src/batch-surgical-repair.test.ts#readTaskCheckpoint
  - packages/core/src/batch-surgical-repair.test.ts#readTopicTaskCheckpoint
  - packages/core/src/batch-surgical-repair.test.ts#surgicalOutcomeOf
  - packages/core/src/batch-surgical-repair.test.ts#writeFlowRepo
  - packages/core/src/batch-surgical-repair.test.ts#writeModuleRepo
  - packages/core/src/batch-test-role.test.ts#RefineMock
  - packages/core/src/batch-test-role.test.ts#RefineMock.generate
  - packages/core/src/batch-test-role.test.ts#TestRoleMockLlm
  - packages/core/src/batch-test-role.test.ts#TestRoleMockLlm.generate
  - packages/core/src/batch-test-role.test.ts#exists
  - packages/core/src/batch-test-role.test.ts#makeValidPage
  - packages/core/src/batch-test-role.test.ts#parseClosedKeys
  - packages/core/src/batch-test-role.test.ts#staleGeneratedPage
  - packages/core/src/batch-understanding.test.ts#UnderstandingMockLlm
  - packages/core/src/batch-understanding.test.ts#UnderstandingMockLlm.generate
  - packages/core/src/batch-understanding.test.ts#fileExists
  - packages/core/src/batch-understanding.test.ts#makeFlowPage
  - packages/core/src/batch-understanding.test.ts#makeInvalidUnderstandingPage
  - packages/core/src/batch-understanding.test.ts#makeUnderstandingPage
  - packages/core/src/batch-understanding.test.ts#makeValidPage
  - packages/core/src/batch-understanding.test.ts#parseClosedKeys
  - packages/core/src/batch-understanding.test.ts#parseFlowPrompt
  - packages/core/src/batch-understanding.test.ts#readLatestUnderstandingCheckpoint
  - packages/core/src/batch-understanding.test.ts#writeFlowRepo
---

# Core Src Tests 02

`core-src-tests-02` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 5 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### parseClosedKeys (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#parseClosedKeys -->

`function parseClosedKeys(user: string): string[] {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseFlowPrompt (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#parseFlowPrompt -->

`function parseFlowPrompt(user: string): FlowPromptCtx {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeValidPage (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeValidPage -->

`function makeValidPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeCompactAuxiliaryPage
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage -->

`function makeCompactAuxiliaryPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeFlowPage (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeFlowPage -->

`function makeFlowPage(ctx: FlowPromptCtx, _diagramSource: string): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### Stage5MockLlm
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm -->

`class Stage5MockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### Stage5MockLlm.generate
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeFlowRepo (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#writeFlowRepo -->

`async function writeFlowRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readTaskCheckpoint (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#readTaskCheckpoint -->

`async function readTaskCheckpoint(` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readLatestRunTaskCheckpoint
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#readLatestRunTaskCheckpoint -->

`async function readLatestRunTaskCheckpoint(` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### countStage5Tasks
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#countStage5Tasks -->

`async function countStage5Tasks(root: string): Promise<number> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### fileExists (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#fileExists -->

`async function fileExists(root: string, rel: string): Promise<boolean> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeFlowPageWithSections
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections -->

`function makeFlowPageWithSections(` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeGroupFlowRepo
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo -->

`async function writeGroupFlowRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### isTopicRefineRequest
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#isTopicRefineRequest -->

`function isTopicRefineRequest(req: GenerateRequest): boolean {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeTopicPage (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeTopicPage -->

`function makeTopicPage(user: string): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### TopicMockLlm
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#TopicMockLlm -->

`class TopicMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### TopicMockLlm.generate
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#TopicMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeTopicEligibleRepo
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#writeTopicEligibleRepo -->

`async function writeTopicEligibleRepo(): Promise<void> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeHubAndSpokeTopicRepo
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#writeHubAndSpokeTopicRepo -->

`async function writeHubAndSpokeTopicRepo(): Promise<void> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### findTopicPagePath
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#findTopicPagePath -->

`async function findTopicPagePath(root: string): Promise<string | null> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readTopicTaskCheckpoint (batch-stage5.test.ts)
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#readTopicTaskCheckpoint -->

`async function readTopicTaskCheckpoint(root: string): Promise<TaskCheckpoint | null> {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneModuleAlwaysTruncatesLlm
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm -->

`class OneModuleAlwaysTruncatesLlm implements LlmClient {` is a class defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneModuleAlwaysTruncatesLlm.generate
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeStrictFailingFlowPage
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeStrictFailingFlowPage -->

`function makeStrictFailingFlowPage(ctx: FlowPromptCtx): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeRelaxedFlowPage
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeRelaxedFlowPage -->

`function makeRelaxedFlowPage(ctx: FlowPromptCtx): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseTopicPrompt
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#parseTopicPrompt -->

`function parseTopicPrompt(user: string): TopicPrompt {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### topicFrontmatter
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#topicFrontmatter -->

`function topicFrontmatter(t: TopicPrompt, anchors: readonly string[]): string[] {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### topicRelatedPages
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#topicRelatedPages -->

`function topicRelatedPages(t: TopicPrompt): string[] {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeStrictFailingTopicPage
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeStrictFailingTopicPage -->

`function makeStrictFailingTopicPage(user: string): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeRelaxedTopicPage
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#makeRelaxedTopicPage -->

`function makeRelaxedTopicPage(user: string): string {` is a function defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### RelaxedTopicMockLlm
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm -->

`class RelaxedTopicMockLlm extends Stage5MockLlm {` is a class defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### RelaxedTopicMockLlm.generate
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm.generate -->

`override async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-stage5.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneShotMockLlm
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm -->

`class OneShotMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneShotMockLlm.generate
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm.generate -->

`async generate(): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### seedLegacyCheckpoint
<!-- lw:anchors packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`async function seedLegacyCheckpoint(): Promise<number> {` is a function defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### ValidMockLlm
<!-- lw:anchors packages/core/src/batch-status.test.ts#ValidMockLlm -->

`class ValidMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### ValidMockLlm.generate
<!-- lw:anchors packages/core/src/batch-status.test.ts#ValidMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneModuleMockLlm
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneModuleMockLlm -->

`class OneModuleMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### OneModuleMockLlm.generate
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-status.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseClosedKeys (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#parseClosedKeys -->

`function parseClosedKeys(user: string): string[] {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseFlowPrompt (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#parseFlowPrompt -->

`function parseFlowPrompt(user: string): FlowPromptCtx {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeValidPage (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeValidPage -->

`function makeValidPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeEmptySectionPage
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeEmptySectionPage -->

`function makeEmptySectionPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeFlowPage (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeFlowPage -->

`function makeFlowPage(ctx: FlowPromptCtx): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeFlowPagePurposeBullets
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeFlowPagePurposeBullets -->

`function makeFlowPagePurposeBullets(ctx: FlowPromptCtx): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeTopicPage (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeTopicPage -->

`function makeTopicPage(user: string): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeTopicPageEmptyChangeMap
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#makeTopicPageEmptyChangeMap -->

`function makeTopicPageEmptyChangeMap(user: string): string {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeFlowRepo (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#writeFlowRepo -->

`async function writeFlowRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readTaskCheckpoint (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#readTaskCheckpoint -->

`async function readTaskCheckpoint(` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readTopicTaskCheckpoint (batch-surgical-repair.test.ts)
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#readTopicTaskCheckpoint -->

`async function readTopicTaskCheckpoint(root: string): Promise<TaskCheckpoint | null> {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### surgicalOutcomeOf
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#surgicalOutcomeOf -->

`function surgicalOutcomeOf(entry: unknown): string | undefined {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### expectJoinedAttempts
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#expectJoinedAttempts -->

`function expectJoinedAttempts(checkpoint: TaskCheckpoint): void {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalModuleMockLlm
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm -->

`class SurgicalModuleMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalModuleMockLlm.generate
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeModuleRepo
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#writeModuleRepo -->

`async function writeModuleRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalFlowMockLlm
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm -->

`class SurgicalFlowMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalFlowMockLlm.generate
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalTopicMockLlm
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm -->

`class SurgicalTopicMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### SurgicalTopicMockLlm.generate
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-surgical-repair.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseClosedKeys (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#parseClosedKeys -->

`function parseClosedKeys(user: string): string[] {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseFlowPrompt (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#parseFlowPrompt -->

`function parseFlowPrompt(user: string): FlowPromptCtx {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeValidPage (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#makeValidPage -->

`function makeValidPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeFlowPage (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#makeFlowPage -->

`function makeFlowPage(ctx: FlowPromptCtx): string {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeUnderstandingPage
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#makeUnderstandingPage -->

`function makeUnderstandingPage(): string {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeInvalidUnderstandingPage
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#makeInvalidUnderstandingPage -->

`function makeInvalidUnderstandingPage(): string {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### UnderstandingMockLlm
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#UnderstandingMockLlm -->

`class UnderstandingMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### UnderstandingMockLlm.generate
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#UnderstandingMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### writeFlowRepo (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#writeFlowRepo -->

`async function writeFlowRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### readLatestUnderstandingCheckpoint
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#readLatestUnderstandingCheckpoint -->

`async function readLatestUnderstandingCheckpoint(root: string): Promise<TaskCheckpoint | null> {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### fileExists (batch-understanding.test.ts)
<!-- lw:anchors packages/core/src/batch-understanding.test.ts#fileExists -->

`async function fileExists(root: string, rel: string): Promise<boolean> {` is a function defined in `packages/core/src/batch-understanding.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### parseClosedKeys (batch-test-role.test.ts)
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#parseClosedKeys -->

`function parseClosedKeys(user: string): string[] {` is a function defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### makeValidPage (batch-test-role.test.ts)
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#makeValidPage -->

`function makeValidPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### TestRoleMockLlm
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#TestRoleMockLlm -->

`class TestRoleMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### TestRoleMockLlm.generate
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#TestRoleMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### staleGeneratedPage
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#staleGeneratedPage -->

`function staleGeneratedPage(): string {` is a function defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### exists
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#exists -->

`async function exists(rel: string): Promise<boolean> {` is a function defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### RefineMock
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#RefineMock -->

`class RefineMock extends TestRoleMockLlm {` is a class defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

### RefineMock.generate
<!-- lw:anchors packages/core/src/batch-test-role.test.ts#RefineMock.generate -->

`override async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-test-role.test.ts`, part of the automated tests surface of `core-src-tests-02` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (5 files, ~182k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
