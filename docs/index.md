---
layout: page
navbar: false
---

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import TextType from "./components/TextType/TextType.vue";
import Galaxy from "./components/Galaxy/Galaxy.vue";

</script>

<div class="galaxy-wrap">
  <Galaxy />
  <div class="slogan" >
    <TextType
      text="I am thinking..."
      as="h1"
    />
  </div>
  <a href="/dashboard.html" class="enter-btn">开始探索</a>
</div>

<style scoped>
  .galaxy-wrap {
    position: relative;
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
    background: #000;
  }
  .slogan {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .slogan :deep(h1) {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: clamp(3rem, 12vw, 9rem);
    color: #fff;
  }
  .enter-btn {
    position: absolute;
    bottom: 3rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 32px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    color: #fff;
    text-decoration: none;
    font-size: 1rem;
    backdrop-filter: blur(8px);
    transition: all 0.3s;
  }
  .enter-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
  }
</style>
