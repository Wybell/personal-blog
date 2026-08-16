---
title: "Spring Security + JWT 在前后端分离应用中的认证链路"
description: "从请求进入过滤器到资源归属校验，拆解无状态 JWT 认证、SecurityContext、统一 401/403、BCrypt 和 SSE 认证边界。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: learning
projectSlug: ai-interview-assistant
cover: /cover-learning-jwt-security.png
coverAlt: "Spring Security 与 JWT 认证链路封面"
tags:
  - Spring Security
  - JWT
  - JJWT
  - BCrypt
  - SSE
  - 前后端分离
featured: false
---

前后端分离应用里的登录，真正困难的部分不是把用户名密码提交给后端，而是把“身份已经确认”“当前请求是谁”“这个资源是否属于他”“过期后如何恢复”这几件事拆成稳定的责任边界。

这篇文章以 AI 面试助手当前的认证实现作为案例，但重点放在可迁移的设计方法：Spring Security 如何建立 `SecurityContext`，JWT 过滤器为什么只负责识别身份，统一 401/403 如何避免前端猜测错误，BCrypt 和资源归属校验分别解决什么问题，以及 SSE 长连接应该怎样处理认证边界。

## 一、先定义认证链路

一次受保护请求可以抽象成下面的流程：

```text
浏览器保存 Access Token
        |
        v
Authorization: Bearer <token>
        |
        v
JwtAuthenticationFilter
        |
        +-- token 无效 -> SecurityContext 不写入
        |
        +-- token 有效 -> 解析 userId/username -> 构造 Authentication
                                      |
                                      v
                         SecurityContextHolder
                                      |
                                      v
                 Controller / Service 读取当前用户
                                      |
                                      v
                 资源归属校验 -> 执行业务 -> JSON 响应
```

这里有一个容易混淆的点：JWT 是“携带身份声明”的凭证，不是业务权限本身。过滤器验证签名、过期时间并取出用户标识后，仍然需要把身份放入 Spring Security 的 `SecurityContext`，后续代码才能把它当作当前请求的认证上下文使用。

## 二、`JwtAuthenticationFilter` 应该做什么

当前项目的 `JwtAuthenticationFilter` 继承 `OncePerRequestFilter`，只处理带有 `Bearer ` 前缀的 `Authorization` 请求头，并且在 `SecurityContextHolder` 尚未存在认证对象时才创建认证：

```java
String authHeader = request.getHeader("Authorization");

if (authHeader != null
        && authHeader.startsWith("Bearer ")
        && SecurityContextHolder.getContext().getAuthentication() == null) {
    String token = authHeader.substring(7);

    if (jwtUtil.validateToken(token)) {
        JwtUserPrincipal principal = new JwtUserPrincipal(
                jwtUtil.getUserIdFromToken(token),
                jwtUtil.getUsernameFromToken(token));

        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                        principal,
                        null,
                        authoritiesFromDatabase(principal.userId()));

        SecurityContextHolder.getContext().setAuthentication(authentication);
    }
}

filterChain.doFilter(request, response);
```

过滤器不应该在这里读取简历、判断活动是否属于用户，甚至不应该把所有业务权限都塞进 JWT。它只负责完成“这个请求是否携带了一个可以被系统识别的身份”。在当前实现中，过滤器还会通过 `UserMapper` 读取用户角色并构造 `ROLE_` 前缀的权限，随后再交给 Spring Security 的授权阶段处理。

如果 token 无效，过滤器继续放行请求，但不设置认证。这样由后面的安全配置统一决定是返回 401，还是让公开接口继续执行。过滤器中直接写响应会让公开路径、异常格式和业务异常变得难以统一。

## 三、`SecurityContext` 不是资源归属校验

`SecurityContext` 只能回答“当前请求以谁的身份执行”。它不能回答“这个用户是否拥有 URL 中的 resumeId 或 sessionId”。后者必须在 Service 层用查询条件明确表达。

当前 AI 面试助手的简历查询类似这样：

```java
ResumeDocument document = resumeDocumentMapper.selectOne(
        new LambdaQueryWrapper<ResumeDocument>()
                .eq(ResumeDocument::getId, resumeId)
                .eq(ResumeDocument::getUserId, userId));

if (document == null) {
    throw new BusinessException(404, "Resume not found");
}
```

`MockInterviewService` 对 session 和 turn 也采用同样边界：先按 `sessionId + userId` 查询会话，再按 `turnId + sessionId` 查询问题。只检查 token 里的 `userId`，却用 `selectById` 读取资源，是典型的越权漏洞来源。

可以把权限拆成三层：

| 层次 | 要回答的问题 | 适合放置的位置 |
| --- | --- | --- |
| 身份认证 | 请求是谁发出的 | JWT 过滤器、`SecurityContext` |
| 粗粒度授权 | 是否登录、是否有角色 | `SecurityConfig`、方法授权 |
| 资源归属 | 这个具体对象是否属于当前用户 | Service 查询条件 |

三层缺一不可。把资源归属全交给前端隐藏按钮，或者只依赖 JWT 中的角色，都不能替代后端的归属查询。

## 四、统一处理 401 和 403

当前 `SecurityConfig` 使用无状态会话策略，关闭 CSRF，禁用表单登录和 HTTP Basic，并将 `JwtAuthenticationFilter` 放在 `UsernamePasswordAuthenticationFilter` 之前：

```java
http
    .csrf().disable()
    .sessionManagement(session -> session
        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
    .authorizeHttpRequests(auth -> auth
        .requestMatchers("/api/auth/**").permitAll()
        .anyRequest().authenticated())
    .exceptionHandling(exception -> exception
        .authenticationEntryPoint(restSecurityExceptionHandler)
        .accessDeniedHandler(restSecurityExceptionHandler))
    .addFilterBefore(jwtAuthenticationFilter,
        UsernamePasswordAuthenticationFilter.class);
```

`RestSecurityExceptionHandler` 把未认证和已认证但无权限区分为两个 HTTP 状态：

```json
// 401
{"code":401,"message":"未登录或登录状态已失效","data":null}

// 403
{"code":403,"message":"无权访问该资源","data":null}
```

前端可以据此做稳定处理：401 进入登录恢复流程，403 展示无权访问；不要把所有错误都当成“token 过期”并无限刷新。

## 五、密码、JWT 和 Refresh Token 的边界

密码不能使用可逆加密，也不能直接使用 MD5。注册或修改密码时使用 BCrypt，登录时由 `PasswordEncoder.matches(raw, encoded)` 完成验证。数据库只保存 BCrypt 哈希，不保存原密码。

Access Token 适合短生命周期的 API 访问，Refresh Token 适合较长生命周期的会话恢复。一个可迁移的 Refresh Token 设计是：

1. 只把 Refresh Token 的摘要写入数据库，而不是保存明文。
2. 每次刷新校验摘要、过期时间和撤销状态。
3. 刷新成功后撤销旧 token 并签发新 token，避免旧 token 无限复用。
4. 检测到同一 token 被重复使用时，按 token family 撤销整组会话。

当前项目的认证主链路是 JWT 无状态过滤器；Refresh Token 的持久化、轮换和撤销应被看作登录恢复层，不能因为 Access Token 是 JWT 就把所有会话状态都放在浏览器里。更重要的是，JWT 密钥、AI API Key 和数据库密码都必须由环境配置注入，不能写进 Git。

## 六、SSE 不是另一套认证系统

AI 面试助手的流式评分接口仍然是受保护的 HTTP 请求，浏览器在建立 SSE 请求时携带 Bearer Token。认证完成后，Controller 将任务交给 `InterviewScoreSseAdapter`，后端再通过 AI 客户端读取上游流并向客户端发送事件。

```text
POST /api/question/score/stream
Authorization: Bearer <access-token>
        |
        v
JwtAuthenticationFilter -> UserContext
        |
        v
InterviewScoreSseAdapter
        |
        v
AiClient.generateStream(..., deltaConsumer)
        |
        v
event: delta / done / error
```

SSE 的认证边界有三个实际问题：

- 建立连接时验证 token，不能只依赖页面已经登录的事实。
- 流式任务被客户端断开后要能取消底层任务，不能让线程和上游请求无期限运行。
- 认证失败和上游 AI 失败要使用不同的错误语义，前者由 401/403 处理，后者由流式 `error` 事件或 5xx 处理。

## 七、常见错误与验证方法

### 1. 把 JWT 解析成功当成用户一定存在

token 里的 userId 可能对应已删除用户。过滤器应避免把不存在的用户当成有效角色，业务查询也必须继续检查资源存在性。

### 2. 只在 Controller 做 userId 校验

Service 可能被其他 Controller、定时任务或测试直接调用。归属校验应在实际拥有数据访问责任的 Service 层再次完成。

### 3. 401 刷新请求递归触发拦截器

刷新 token 的请求应该加入白名单，或者在 Axios 拦截器中显式排除刷新路径。多个请求同时 401 时用 single-flight：第一个请求负责刷新，其余请求等待同一个 Promise，避免并发刷新互相覆盖。

### 4. 关闭 CSRF 后忽略部署边界

当前是 Authorization Header 的前后端分离应用，关闭 CSRF 与认证方式有关，不代表所有部署方式都可以照搬。若改为 Cookie 自动携带 token，就要重新评估 CSRF、SameSite 和跨域策略。

当前项目能验证的是 Spring Boot 测试、JWT 过滤器测试、服务层归属判断和 SSE 适配逻辑。它不是 OAuth2 授权服务器，也没有宣称完成 SSO、设备管理、全量会话撤销或高并发安全压测。

## 八、可迁移结论

认证设计的最小可靠闭环是：过滤器确认身份，`SecurityContext` 传递身份，安全处理器统一输出 401/403，Service 用数据库条件完成资源归属校验，密码使用 BCrypt，Access/Refresh Token 分工明确，SSE 复用同一认证边界。

只要把这些职责拆开，换成其他 Spring Boot 前后端分离项目时，接口路径、实体名称和前端框架可以变化，安全模型仍然成立。
