---
title: "AI 多模型运行时路由：把外部协议差异关在适配层"
description: "结合 AI 面试助手的运行时模型目录与客户端注册表，拆解 provider 路由、allowlist、用户偏好、协议适配、Prompt 约束和上游异常处理。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: practice
projectSlug: ai-interview-assistant
cover: /cover-practice-model-routing.png
coverAlt: "AI 多模型运行时路由封面"
tags:
  - AI 应用
  - Spring Boot
  - 多模型路由
  - SSE
  - 外部服务适配
  - 数据库设计
featured: false
---

AI 项目早期最容易出现的结构是：在业务 Service 里写一段 HTTP 请求，换一个模型再复制一段，最后让业务代码同时知道 provider、endpoint、请求 JSON、响应 JSON 和流式事件格式。第一次接入时它可以工作，但一旦用户能够选择模型，外部协议出现差异，代码就会快速失去边界。

AI 面试助手当前采用 `AiClient` 抽象、`AiClientRegistry` 注册表、数据库模型目录和用户偏好四层结构。它不是自研大模型，也不是微服务平台，而是一个单体 Spring Boot 应用中对多个外部 AI 服务的运行时适配。

## 一、路由的输入不是一个字符串

一次模型调用至少需要两个维度：

```text
ai_model.id        -> 数据库中的可选模型记录
ai_model.provider  -> deepseek / custom / change2proapi
ai_model.model_code -> deepseek-v4-flash / gpt-5.6-luna ...
```

业务侧拿到的是 `EffectiveAiModel`，包含数据库模型 id、provider、modelCode 和展示信息；真正发请求时才由客户端适配层使用 provider 和 modelCode。这样业务代码不需要知道某个 provider 的 URL 或请求体字段。

```java
EffectiveAiModel model = userAiPreferenceService.resolveEffectiveModel(userId);

String answer = aiClientRegistry.generate(
        model.provider(),
        model.modelCode(),
        systemPrompt,
        userContent);
```

## 二、`AiClient` 抽象和注册表

当前接口只暴露统一能力：

```java
public interface AiClient {
    String provider();
    boolean isConfigured();
    String generate(String modelCode, String systemPrompt, String userContent);
    String generateStream(
            String modelCode,
            String systemPrompt,
            String userContent,
            AiTextDeltaConsumer deltaConsumer);
}
```

`DeepSeekAiClient`、`CustomResponsesAiClient` 和 `Change2ProResponsesAiClient` 都实现这个接口。`AiClientRegistry` 在 Spring 启动时接收所有 `AiClient`，按规范化后的 provider 建立不可变 Map，并拒绝重复 provider：

```java
Map<String, AiClient> registered = new HashMap<>();
for (AiClient client : aiClients) {
    String provider = client.provider().trim().toLowerCase(Locale.ROOT);
    if (registered.putIfAbsent(provider, client) != null) {
        throw new IllegalStateException("Duplicate AI client provider: " + provider);
    }
}
clientsByProvider = Map.copyOf(registered);
```

注册表还有两个重要行为：调用前要求 provider、modelCode 和客户端配置都存在；客户端把上游失败转换成 `BusinessException` 后，注册表把 500 级配置问题统一成“模型暂不可用”的 503。业务层不需要为每个 provider 写一套异常判断。

## 三、allowlist 先于外部请求

数据库中的 `ai_model` 是可选模型目录，而不是前端可以随意提交的模型字符串。V2 建立模型目录、默认策略和用户偏好；V6 增加 custom provider；V8 恢复 DeepSeek 默认模型并保留 custom 选项。模型目录有 `(provider, model_code)` 唯一约束，enabled 和 sort_order 控制展示。

`AiModelCatalogService` 查询 enabled 模型后，还会调用 `AiClientRegistry.isModelAvailable` 过滤运行时没有配置 API Key 或 endpoint 的 provider。`UserAiPreferenceService` 在保存偏好时同时检查：模型存在、enabled、客户端运行时已配置。有效模型解析顺序是：

```text
用户偏好存在且可用
        |
        +-- 是 -> 使用用户偏好
        |
        +-- 否 -> 使用系统默认模型
                       |
                       +-- 默认模型不可用 -> 503
```

这组校验避免了两个常见错误：前端把任意字符串当成 modelCode 直传上游，以及数据库里显示了一个实际上没有 API Key 的模型。allowlist 解决的是“能不能选”，客户端 `isConfigured()` 解决的是“当前能不能调用”。

## 四、三个客户端面对两种协议

`DeepSeekAiClient` 使用 Chat Completions 风格请求：

```json
{
  "model": "deepseek-v4-flash",
  "stream": false,
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ]
}
```

它从 `choices[0].message.content` 读取非流式文本，从每个 SSE data 的 `choices[0].delta.content` 读取增量。

`CustomResponsesAiClient` 和 `Change2ProResponsesAiClient` 使用 Responses 兼容协议：

```json
{
  "model": "gpt-5.6-luna",
  "instructions": "...",
  "input": "...",
  "store": false,
  "stream": true,
  "reasoning": {"effort": "..."}
}
```

Responses 文本可能位于顶层 `output_text`，也可能位于 `output[].content[]` 的 `type=output_text` 节点。流式事件则可能是 `response.output_text.delta`、`response.output_text.done` 或 `response.completed`。这些差异被留在客户端类中，业务 Service 只接收完整字符串或 `deltaConsumer`。

## 五、SSE 事件读取不能只按换行切字符串

`AiSseEventReader` 使用 `BufferedReader` 读取上游事件，按空行分隔事件，分别收集 `event:` 和多行 `data:`，再交给回调处理：

```text
event: response.output_text.delta
data: {"delta":"Spring"}

event: response.output_text.delta
data: {"delta":" Boot"}

data: [DONE]
```

`CustomResponsesAiClient` 和 `Change2ProResponsesAiClient` 对 cumulative text 做前缀去重：如果 `response.output_text.done` 返回了已经收到的完整文本，只把尚未发送的后缀交给 `deltaConsumer`。这避免了把增量和完整结果重复拼接。

同时，读取循环检查线程中断并抛出 `AiStreamCancelledException`。客户端关闭连接或任务取消时，底层请求应该结束，不能一直占用线程。

## 六、Prompt 和结构化输出仍然需要业务校验

模型路由只解决“请求发给谁”，不能保证返回结果一定符合业务格式。当前项目的 AI Service 会给出 system prompt 约束，并在评分、面试题和复盘结果返回后做文本或 JSON 结构处理；外部返回为空、JSON 解析失败、HTTP 非 2xx 和 60 秒超时都会转换为业务可识别的错误。

一条可迁移的调用边界是：

```text
业务 Service
  -> 组装业务上下文和 Prompt
  -> AiClientRegistry
  -> provider adapter
  -> HTTP / SSE
  -> adapter 提取文本和增量
  -> 业务层校验结构、落库或返回
```

不要让 provider adapter 直接决定业务字段，也不要让业务层解析每一种上游协议。Prompt 是输入约束，结果校验是输出约束，两者都不能被“模型通常会按格式返回”替代。

## 七、配置、密钥和不可用模型

API Key、endpoint、reasoning effort 和是否关闭 Responses 存储都来自 `AiProperties`，客户端只判断配置是否完整。密钥不进入数据库模型目录，也不写入 Git。数据库保存的是可展示的 provider、modelCode、enabled 和偏好关系，运行配置由环境注入。

当前实现将常见失败分成几类：

- 400：业务输入或模型选择参数不合法。
- 502：上游返回错误、网络 I/O 或响应格式不符合预期。
- 503：模型未启用、客户端未配置或运行时不可用。
- 504：上游在客户端 60 秒超时。
- 流式取消：保留线程中断语义，不伪装成普通上游失败。

这套分类不等于已经具备重试、熔断、限流和多节点故障转移。当前项目是单体 Docker Compose 部署，没有自研大模型，也没有把外部中转服务包装成自建模型平台。

## 八、测试与适用边界

当前可以围绕 `AiClientRegistry` 的重复 provider、不可用模型，`DeepSeekAiClient` 的 Chat Completions 解析，`CustomResponsesAiClient`/`Change2ProResponsesAiClient` 的 Responses 文本与 SSE 解析写单元测试。还需要注意，Mock HTTP 响应测试不能替代真实第三方服务的协议变化验证。

这套设计适合模型数量有限、业务调用类型相对稳定的单体应用。若 provider 数量继续增长，应该再考虑契约测试、超时预算、指标、限流和密钥轮换；不能因为增加了三个客户端类就宣称已经完成分布式 AI 网关。

## 九、可迁移结论

运行时模型路由的核心不是 `if provider == ...`，而是把模型目录、用户偏好、运行时可用性和协议适配拆开：数据库负责 allowlist，`AiClientRegistry` 负责选择，具体 client 负责协议，业务层负责 Prompt、业务校验和落库。这样从启动期固定 provider 切换到运行时模型路由时，变化被控制在边界内，测试也有清晰的落点。
