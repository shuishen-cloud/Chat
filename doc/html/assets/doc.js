/* ============================================================
   shadcn-chat 系统文档 · 交互增强
   ------------------------------------------------------------
   只做增强，不做必需：JS 失效时侧栏目录仍是原生 <a> 链接，
   页面可正常阅读与跳转。所有功能在失败时静默降级。
   ============================================================ */
(function () {
  "use strict"

  /* ---------------- 侧栏目录：从当前页 DOM 抽取 ---------------- */

  /**
   * 目录不手写，直接从正文的 h2/h3 生成。
   * 手写目录与正文必然漂移，且新增小节时容易忘记同步。
   */
  function buildSidebarToc() {
    var body = document.querySelector(".toc-source")
    var toc = document.querySelector("[data-toc]")
    if (!body || !toc) return

    /*
     * 目录来源两类节点：
     *  - h2 / h3：章节标题；
     *  - .card[id]：模块卡片（模块名是 div 而非标题，但它是最常用的跳转目标）。
     * 两类一起按 DOM 顺序遍历，排序自然与正文一致。
     */
    var headings = body.querySelectorAll("h2[id], h3[id], .card[id]")
    if (!headings.length) return

    var frag = document.createDocumentFragment()
    var currentList = null
    var currentH2Item = null

    headings.forEach(function (h) {
      var isCard = h.classList.contains("card")
      var level = isCard ? 3 : h.tagName === "H2" ? 2 : 3
      var link = document.createElement("a")
      link.href = "#" + h.id
      link.textContent = isCard ? cardText(h) : headingText(h)
      link.dataset.target = h.id

      var li = document.createElement("li")
      li.className = "level-" + level + (isCard ? " module" : "")
      li.appendChild(link)

      if (level === 2) {
        // 新的 h2：开一个新分组，后面的 h3 / 模块卡挂在它下面
        currentH2Item = li
        frag.appendChild(li)
        currentList = null
      } else {
        if (!currentList) {
          currentList = document.createElement("ul")
          if (currentH2Item) currentH2Item.appendChild(currentList)
          else frag.appendChild(currentList)
        }
        currentList.appendChild(li)
      }
    })

    toc.appendChild(frag)
  }

  /** 模块卡片：取文件名作目录文字 */
  function cardText(card) {
    var name = card.querySelector(".card-head .name")
    return name ? name.textContent.replace(/\s+/g, " ").trim() : card.id
  }

  /** 取标题纯文本，去掉层级徽章等子元素里的噪音 */
  function headingText(h) {
    var clone = h.cloneNode(true)
    var badge = clone.querySelector(".layer")
    var text = clone.textContent || ""
    if (badge) text = text.replace(badge.textContent || "", "")
    return text.replace(/\s+/g, " ").trim()
  }

  /* ---------------- 滚动高亮当前小节 ---------------- */

  function setupScrollSpy() {
    var links = Array.prototype.slice.call(
      document.querySelectorAll("[data-toc] a[data-target]")
    )
    if (!links.length || !("IntersectionObserver" in window)) return

    var byId = {}
    links.forEach(function (a) {
      byId[a.dataset.target] = a
    })

    var active = null
    function setActive(id) {
      if (id === active) return
      if (active && byId[active]) byId[active].classList.remove("active")
      active = id
      if (byId[id]) {
        byId[id].classList.add("active")
        scrollSidebarTo(byId[id])
      }
    }

    var observer = new IntersectionObserver(
      function (entries) {
        // 取视口内最靠上的可见小节作为当前小节
        var visible = entries
          .filter(function (e) {
            return e.isIntersecting
          })
          .sort(function (a, b) {
            return a.boundingClientRect.top - b.boundingClientRect.top
          })
        if (visible.length) setActive(visible[0].target.id)
      },
      // 顶部留出 sticky 顶栏的高度，底部留大半屏，避免刚露出就被判为当前
      { rootMargin: "-72px 0px -62% 0px", threshold: 0 }
    )

    links.forEach(function (a) {
      var el = document.getElementById(a.dataset.target)
      if (el) observer.observe(el)
    })
    if (links[0] && links[0].dataset.target) setActive(links[0].dataset.target)
  }

  /** 侧栏自身滚动：让高亮项始终可见，但不打断页面的锚点滚动 */
  function scrollSidebarTo(link) {
    var sidebar = document.querySelector(".sidebar")
    if (!sidebar) return
    var lr = link.getBoundingClientRect()
    var sr = sidebar.getBoundingClientRect()
    if (lr.top < sr.top || lr.bottom > sr.bottom - 8) {
      sidebar.scrollTop += lr.top - sr.top - sr.height / 2
    }
  }

  /* ---------------- 搜索：过滤侧栏目录 ---------------- */

  function setupSearch() {
    var input = document.querySelector("[data-search]")
    var sidebar = document.querySelector(".sidebar")
    var toc = document.querySelector("[data-toc]")
    if (!input || !sidebar || !toc) return

    var empty = document.createElement("div")
    empty.className = "no-result"
    empty.textContent = "没有匹配的条目"
    toc.appendChild(empty)

    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase()
      sidebar.classList.toggle("filtering", q !== "")

      var items = toc.querySelectorAll("li")
      var hit = 0

      items.forEach(function (li) {
        if (li.querySelector("li")) return // 只处理叶子项
        var link = li.querySelector("a")
        if (!link) return
        var matched = q === "" || link.textContent.toLowerCase().indexOf(q) !== -1
        li.hidden = !matched
        if (matched && q !== "") hit++
      })

      // 父级 li 在有任何可见子项时要显示
      var groups = toc.querySelectorAll("li")
      groups.forEach(function (li) {
        var sub = li.querySelector("ul")
        if (!sub) return
        var anyVisible = sub.querySelector("li:not([hidden])") !== null
        li.hidden = q !== "" && !anyVisible
      })

      empty.dataset.empty = q !== "" && hit === 0 ? "1" : "0"
    })

    // Esc 清空
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        input.value = ""
        input.dispatchEvent(new Event("input"))
        input.blur()
      }
      // 回车跳到第一条匹配
      if (e.key === "Enter") {
        var first = toc.querySelector("li:not([hidden]) a")
        if (first) window.location.hash = first.getAttribute("href")
      }
    })
  }

  /* ---------------- 快捷键：/ 聚焦搜索 ---------------- */

  function setupShortcut() {
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || ""
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var input = document.querySelector("[data-search]")
        if (input) {
          e.preventDefault()
          input.focus()
          input.select()
        }
      }
    })
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    try {
      buildSidebarToc()
      setupScrollSpy()
      setupSearch()
      setupShortcut()
    } catch (err) {
      // 增强失败不影响阅读，静默降级
      if (window.console) console.warn("[doc] 增强脚本降级：", err)
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
