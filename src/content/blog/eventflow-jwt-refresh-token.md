---
title: "JWT 认证的完整链路：从 Access Token 到 Refresh Token 轮换"
description: "以 EventFlow 为例，理解 JWT 无状态认证、Refresh Token 持久化、轮换撤销和前端 401 重试之间如何组成一条完整的登录链路。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: learning
projectSlug: eventflow
cover: /cover-learning-jwt-refresh.png
coverAlt: "JWT Refresh Token 轮换封面"
tags:
  - JWT
  - Spring Security
  - JJWT
  - Refresh Token
  - TypeScript
  - Web 安全
featured: false
---

很多登录功能的示例只展示“用户名密码换一个 token”，但真正进入一个有多个页面和多个 API 的应用之后，认证问题会继续向下展开：Access Token 过期时谁负责续期，续期请求会不会和普通请求互相递归，Refresh Token 泄露后能不能被撤销，多个请求同时返回 401 时前端会不会发起一批刷新请求。

我在 EventFlow 中使用 Java 17、Spring Boot 3.4.4、Spring Security 和 JJWT 实现了 Access Token + Refresh Token 的认证方式。这篇文章把它当成一个技术学习主题来拆解，重点讲清楚每个 token 的职责、后端的轮换过程和前端 Axios 拦截器的协作方式。它不是 OAuth 2.0 或 SSO 的完整实现，文章只讨论项目当前真正使用的认证模型。

## 一、先区分两个 token 的职责

Access Token 和 Refresh Token 都被称为 token，但它们的安全边界不同。如果把它们都当成“登录凭证”，后续的过期、撤销和存储策略就很容易混在一起。

| 类型 | EventFlow 中的用途 | 主要特点 | 服务端处理 |
| --- | --- | --- | --- |
| Access Token | 访问活动、报名、个人信息等 API | JWT、自包含、有效期较短 | 请求通过 `Authorization: Bearer` 交给过滤器解析 |
| Refresh Token | Access Token 过期后换取新 token 对 | 随机字符串、不能直接访问业务 API | 数据库保存摘要，刷新时校验并撤销旧记录 |

Access Token 里可以放用户 ID、用户名和角色等声明，服务端不需要每次请求都查询一条会话记录；Refresh Token 则更像一条可被服务端控制的长期会话凭证，所以它不能只存在于一个无法撤销的 JWT 里。

## 二、登录流程不是一个返回值，而是一组状态变化

EventFlow 的登录过程可以抽象成下面的链路：

```text
用户名和密码
      |
      v
AuthService 校验账号状态与密码
      |
      +--> JwtTokenService 签发短期 Access Token
      |
      +--> RefreshTokenService 生成随机 Refresh Token
                  |
                  +--> 计算 SHA-256 摘要
                  +--> 写入 ef_refresh_token
      |
      v
返回 accessToken、refreshToken、tokenType、expiresIn
```

这里有一个容易忽略的区别：数据库里保存的不是 Refresh Token 原文，而是它的 SHA-256 摘要。即使数据库读取权限被误授，攻击者拿到摘要也不能直接把它当作原始凭证提交；真正的 token 只在登录响应和客户端会话中出现。

## 三、Refresh Token 为什么要轮换

如果一个 Refresh Token 在有效期内可以重复使用，那么它一旦泄露，攻击者可以持续换取新的 Access Token。轮换的核心规则是：

1. 查询当前摘要对应的、未过期且仍有效的 Refresh Token。
2. 用条件更新把这条记录标记为已撤销。
3. 撤销成功后，签发新的 Access Token 和新的 Refresh Token。
4. 旧 Refresh Token 后续再次使用时，查询不到有效记录，刷新失败。

后端服务中，轮换的关键逻辑可以简化为：

```java
@Transactional
public AuthTokenResponse refresh(RefreshTokenRequest request) {
    Long userId = refreshTokenService.rotate(request.refreshToken());
    UserAccount user = userAccountMapper.selectById(userId);

    String accessToken = jwtTokenService.issueAccessToken(user);
    String nextRefreshToken = refreshTokenService.issue(userId);
    return new AuthTokenResponse(
            accessToken,
            nextRefreshToken,
            "Bearer",
            jwtProperties.accessTokenTtl().toSeconds());
}
```

`rotate` 的关键不是普通的 `SELECT`，而是“查询有效记录 + 条件撤销”必须成为一次受保护的操作。即使两个请求同时拿着同一个旧 Refresh Token 到达，也只能有一个请求成功把它撤销；另一个请求看到影响行数不是 `1`，就应该判定为无效，而不是继续签发新 token。

```java
public Long rotate(String token) {
    String tokenHash = hash(token);
    RefreshToken stored = refreshTokenMapper.findActiveByTokenHash(
            tokenHash, LocalDateTime.now(clock));
    if (stored == null
            || refreshTokenMapper.revokeById(
                    stored.getId(), LocalDateTime.now(clock)) != 1) {
        throw new BusinessException(ErrorCode.REFRESH_TOKEN_INVALID);
    }
    return stored.getUserId();
}
```

项目使用 `Clock` 注入业务时间，而不是在业务代码里到处直接调用系统时间。这样测试可以固定当前时间，验证“已过期”“刚好撤销”和“仍然有效”等边界。

## 四、Spring Security 如何把 JWT 放进请求上下文

Access Token 不依赖服务端会话。客户端在每次请求中携带：

```http
Authorization: Bearer eyJ...
X-Request-Id: 6c7d...
```

`JwtAuthenticationFilter` 继承 `OncePerRequestFilter`，只负责三件事：读取 Bearer token、交给 `JwtTokenService` 验签和解析、把解析出的用户和角色放进 `SecurityContextHolder`。角色会被转换为 Spring Security 约定的 `ROLE_` 前缀，例如 `ADMIN` 变成 `ROLE_ADMIN`。

```java
String token = resolveToken(request.getHeader(HttpHeaders.AUTHORIZATION));
if (token != null && SecurityContextHolder.getContext().getAuthentication() == null) {
    jwtTokenService.parseAccessToken(token).ifPresent(this::authenticate);
}
filterChain.doFilter(request, response);
```

过滤器只负责建立身份，不负责判断“这个活动是不是当前用户创建的”。资源归属仍然由具体的 Service 校验，例如活动创建者或管理员才能查看某个活动的报名管理数据。认证和授权是两个不同层次的问题。

## 五、前端 401 为什么不能每次都直接刷新

EventFlow 的前端使用 Axios 建立统一 HTTP 客户端：

- 请求拦截器从 Zustand 会话仓库读取 Access Token。
- 每个请求生成一个 `X-Request-Id`，便于前后端日志关联。
- 响应状态为 401 时，尝试使用 Refresh Token 换取新 token。
- 刷新成功后只重试原请求一次，避免无限循环。
- 登录、注册、刷新和退出接口被排除在自动刷新之外。

多个业务请求可能同时过期。如果每个 401 都独立发起刷新，就会让同一个 Refresh Token 被并发消费。项目使用一个共享的 `refreshPromise` 做前端 single-flight：第一个请求创建刷新 Promise，后续请求复用它，刷新结束后再清空引用。

```ts
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useSessionStore.getState().refreshToken;
  if (refreshToken === null) return null;

  if (refreshPromise === null) {
    refreshPromise = refreshClient
      .post('/v1/auth/refresh', { refreshToken })
      .then((response) => {
        const tokens = response.data.data;
        useSessionStore.getState().updateTokens(
          tokens.accessToken,
          tokens.refreshToken,
        );
        return tokens.accessToken;
      })
      .catch(() => {
        useSessionStore.getState().clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}
```

这里的 `refreshClient` 是一个独立的 Axios 实例。它不挂载普通客户端的 401 拦截器，否则刷新接口自己返回 401 时可能再次触发刷新，形成递归。

## 六、会话状态为什么交给 Zustand，而不是 React Query

React Query 适合管理“服务端状态”，例如我的活动、活动场次和我的报名；登录 token、当前用户和退出动作则是全局客户端会话状态，所以项目使用 Zustand 保存：

```ts
{
  accessToken,
  refreshToken,
  currentUser,
  setSession,
  updateTokens,
  clearSession
}
```

会话仓库使用 `eventflow-session-v1` 做持久化。登录成功或退出时会清理 React Query 缓存，避免上一个用户的活动列表、报名列表在下一个用户的页面里短暂出现。

这套实现并不是绝对安全的终点：当前持久化由 Zustand middleware 完成，浏览器脚本注入风险仍然需要依靠 XSS 防护、依赖审计和更严格的 Cookie 策略共同降低。它解决的是项目中的 token 生命周期和请求协作问题，不等同于生产级身份平台。

## 七、这次学习得到的边界

这条认证链路让我把几个容易混淆的概念分开了：JWT 解决的是 Access Token 的自包含验证，数据库 Refresh Token 解决的是长期会话的可撤销性，Spring Security 负责把身份放进请求上下文，业务 Service 仍然负责资源权限，前端拦截器负责过期后的协作。

EventFlow 当前没有实现 OAuth 授权服务器、第三方登录、设备管理和完整的异常会话检测。文档中的“轮换”是项目当前实现的 Refresh Token 一次性消费逻辑，不应包装成完整的企业级 IAM 系统。
