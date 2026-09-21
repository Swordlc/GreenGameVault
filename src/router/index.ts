import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import type { PageConfig } from '../types/page'
import pageConfigManager from '../utils/PageConfigManager'

// 固定页面路由
const fixedRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../pages/HomeView.vue'),
    meta: {
      title: '主页',
      icon: '🏠',
      description: '欢迎页面，快速访问游戏库',
      requiresFilter: false
    }
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('../pages/SearchView.vue'),
    meta: {
      title: '搜索',
      icon: '🔍',
      description: '在游戏库中搜索内容',
      requiresFilter: false
    }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../pages/SettingsView.vue'),
    meta: {
      title: '设置',
      icon: '⚙️',
      description: '管理应用设置和偏好',
      requiresFilter: false
    }
  },
  {
    path: '/resource-view',
    name: 'resource-view',
    component: () => import('../pages/ResourceView.vue'),
    meta: {
      title: '资源视图',
      icon: '📊',
      description: '资源视图页面',
      requiresFilter: false
    }
  }
]

/**
 * 根据页面配置创建资源路由
 * 页面由 ResourceView 组件承载，内容由配置驱动生成
 */
function createResourceRoute(pageConfig: PageConfig): RouteRecordRaw {
  return {
    path: `/${pageConfig.id}`,
    name: pageConfig.id,
    component: () => import('../components/ResourceView.vue'),
    props: {
      pageConfig: pageConfig
    },
    meta: {
      title: pageConfig.name,
      icon: pageConfig.icon,
      description: pageConfig.description || `${pageConfig.name}管理页面`,
      requiresFilter: true,
      pageConfig: pageConfig
    }
  }
}

/**
 * 从 pageConfigManager 加载动态路由
 */
export async function loadDynamicRoutes(): Promise<RouteRecordRaw[]> {
  const pages = await pageConfigManager.getPages()

  return pages
    .filter(page => !page.isHidden)
    .map(page => createResourceRoute(page))
}

/**
 * 创建路由实例
 */
export async function createAppRouter() {
  // 加载动态路由
  const dynamicRoutes = await loadDynamicRoutes()

  // 合并所有路由
  const routes: RouteRecordRaw[] = [
    ...fixedRoutes,
    ...dynamicRoutes,
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]

  const router = createRouter({
    history: createWebHashHistory(),
    routes
  })

  // 路由守卫：保存最后访问的页面
  router.afterEach((to) => {
    if (to.name && to.name !== 'home') {
      window.dispatchEvent(new CustomEvent('route-changed', {
        detail: { routeName: to.name }
      }))
    }
  })

  return router
}

/**
 * 更新动态路由（当页面配置变化时调用）
 */
export async function updateDynamicRoutes(router: ReturnType<typeof createRouter>) {
  // 移除旧的动态路由（除了固定路由）
  const routesToRemove = router.getRoutes().filter(route => {
    const meta = route.meta as any
    return meta?.pageConfig && !fixedRoutes.some(r => r.name === route.name)
  })

  routesToRemove.forEach(route => {
    if (route.name) {
      router.removeRoute(route.name)
    }
  })

  // 添加新的动态路由
  const newRoutes = await loadDynamicRoutes()
  newRoutes.forEach(route => {
    router.addRoute(route)
  })
}
