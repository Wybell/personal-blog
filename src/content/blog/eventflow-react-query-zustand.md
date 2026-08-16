---
title: "React Query 与 Zustand 的职责边界：前端状态管理如何拆分"
description: "从 EventFlow 的活动工作区和报名页面出发，理解服务端状态、会话状态、页面局部状态的区别，以及查询缓存失效如何保持界面可解释。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: learning
projectSlug: eventflow
cover: /cover-learning-react-state.png
coverAlt: "React Query 与 Zustand 状态管理封面"
tags:
  - React 19
  - TypeScript
  - React Query
  - Zustand
  - Axios
  - 前端架构
featured: false
---

在 EventFlow 里，前端同时存在活动列表、场次名额、我的报名、当前用户、抽屉开关和表单输入。如果把这些数据都放进一个全局 store，任何接口更新都可能让所有组件互相耦合；如果全部交给组件自己的 `useState`，又会重复请求、难以刷新和难以处理登录切换。

我最后采用了 React 19 + TypeScript + TanStack React Query + Zustand 的组合。技术重点不在于“用了两个库”，而在于先区分状态的来源，再让每类状态只由一个地方负责。这篇文章记录我对这套拆分方式的理解。

## 一、先把状态按来源分类

| 状态类型 | 例子 | 所有者 | 生命周期 |
| --- | --- | --- | --- |
| 服务端状态 | 活动列表、场次、报名记录 | React Query | 随接口请求、失效和重新获取变化 |
| 会话状态 | Access Token、Refresh Token、当前用户 | Zustand | 登录到退出，可持久化 |
| 页面局部状态 | 抽屉是否打开、当前选中活动 | React 组件 `useState` | 当前页面或组件生命周期 |
| 表单状态 | 创建活动、添加场次的输入值 | Ant Design Form | 表单打开到提交或重置 |
| 路由状态 | 当前页面和 URL 参数 | React Router | 随导航变化 |

这个分类解决了第一个问题：不能因为某个组件需要读取当前用户，就把整个活动列表也放进 Zustand；也不能因为一个抽屉需要刷新活动列表，就让表单组件直接操作 Axios 请求。

## 二、React Query 管理“远程事实”

EventFlow 的 QueryClient 默认配置是：查询失败重试一次，数据在 30 秒内视为新鲜。它表达的是一个保守的产品取舍：普通列表不需要每次渲染都请求服务器，但失败也不能完全静默。

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});
```

活动创建者页面有两个典型查询：

```tsx
const activityQueryKey = ['activities', 'mine', currentUser?.id] as const;

const activitiesQuery = useQuery({
  queryKey: activityQueryKey,
  queryFn: getMyActivities,
  enabled: currentUser !== null,
});

const sessionsQuery = useQuery({
  queryKey: ['activity-sessions', selectedActivity?.id],
  queryFn: () => getActivitySessions(selectedActivity?.id ?? 0),
  enabled: selectedActivity !== null,
});
```

这里有三个值得学习的点：

1. `currentUser` 没有准备好时，活动查询不会提前发起。
2. 场次查询的 key 包含活动 ID，不同活动不会共用一份缓存。
3. 查询 key 是后续 `invalidateQueries` 的契约，命名时要让它能表达数据范围。

## 三、写操作不直接改列表，而是让缓存失效

创建活动、保存活动、添加场次、提交审核和发布活动都是 mutation。成功后，组件不会手动在本地拼出一个“看起来正确”的活动对象，而是让对应查询失效：

```tsx
const activityMutation = useMutation({
  mutationFn: saveActivity,
  onSuccess: async () => {
    await queryClient.invalidateQueries({
      queryKey: activityQueryKey,
    });
    setActivityDrawerOpen(false);
  },
});
```

报名和取消报名也是同样的思路。报名成功后同时失效“我的报名”和对应活动的公开场次查询，页面才能同时更新报名按钮和剩余名额：

```tsx
await Promise.all([
  queryClient.invalidateQueries({
    queryKey: ['registrations', 'mine', currentUser?.id],
  }),
  queryClient.invalidateQueries({
    queryKey: ['activity-sessions', 'public', activityId],
  }),
]);
```

这不是最高性能的方案，但它有一个重要优点：数据库仍是事实源，前端不需要重复实现一套“报名成功后名额减一、状态切换、取消后名额加一”的业务规则。前端只负责在写操作成功后重新读取事实。

## 四、Zustand 只保存跨页面的会话状态

EventFlow 的 `useSessionStore` 保存 Access Token、Refresh Token 和当前用户。登录成功时，store 会先清理旧的 React Query 缓存，再写入新会话；退出时反过来清理 token、用户信息和查询缓存。

```ts
setSession: (accessToken, refreshToken, currentUser) => {
  queryClient.clear();
  set({ accessToken, refreshToken, currentUser });
},
clearSession: () => {
  queryClient.clear();
  set({
    accessToken: null,
    refreshToken: null,
    currentUser: null,
  });
},
```

清理查询缓存不是装饰性代码。假设用户 A 登出，用户 B 随后登录，如果 Query Cache 仍保留历史数据，页面可能先展示旧数据再刷新。用户边界切换时清理缓存，是前端数据隔离的一部分。

## 五、Axios 负责传输协议，不负责业务缓存

`http-client.ts` 是 API 层的统一入口，它做的是协议工作：

- 为请求添加 `Authorization`。
- 每个请求生成 `X-Request-Id`。
- 把后端统一响应转换为前端 `ApiError`。
- Access Token 过期时协调 Refresh Token 刷新并重试一次。

它不应该知道“创建活动之后要刷新哪个列表”，因为那属于使用 API 的业务组件和 React Query。这样的边界让 API 函数保持简单：

```ts
export async function getPublishedActivities(): Promise<PublicActivity[]> {
  const response = await httpClient.get<ApiResponse<PublicActivity[]>>(
    '/v1/activities/public',
  );
  return response.data.data;
}
```

组件拿到的是业务数据，不需要每个页面都重复处理 Axios 响应外壳。

## 六、查询 key 其实是前端的数据模型

设计 query key 时，我会先回答四个问题：这份数据属于谁、数据的维度是什么、哪个写操作会影响它、能不能只失效一部分。

```text
['activities', 'mine', userId]
['activity-sessions', activityId]
['activity-sessions', 'public', activityId]
['registrations', 'mine', userId]
['activity-registrations', activityId, filters]
```

如果把所有查询都命名成 `['list']`，失效时只能大面积刷新；如果 key 里缺少用户 ID，就要额外小心登录切换；如果把筛选条件遗漏，报名管理页面可能把不同筛选结果错误地共用。

因此，query key 不只是缓存库的参数，也是在前端明确“哪份数据是什么”的一种建模方式。

## 七、什么时候不该使用 React Query 或 Zustand

表单输入没有必要放进 React Query，因为它还没有成为服务端事实；抽屉开关也不应该放进 Zustand，因为它没有跨页面共享价值；Access Token 又不适合由某个页面组件临时保存，因为 Axios 拦截器和多个页面都需要读取它。

工程上最重要的不是选择某个流行库，而是避免一个状态出现多个事实源。EventFlow 的拆分可以概括为：

```text
MySQL / API 响应  -> React Query：服务端状态
登录会话          -> Zustand：跨页面客户端状态
表单和 UI 开关    -> 组件或 Form：局部交互状态
```

当前实现没有做 SSR、离线编辑、复杂 optimistic update，也没有把所有接口都抽象成统一的资源缓存层。对于这个项目的页面规模，明确的 query key 和成功后失效已经足够；未来数据量和交互复杂度继续增长时，再考虑预取、乐观更新和更细粒度的缓存策略。
