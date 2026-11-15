import '@testing-library/jest-dom'

// jsdom 还没实现原生 <dialog> 的模态方法：属性面板、帮助浮层、目录选择
// 与并排对比都用 <dialog> + showModal()，测试里得先补上这两个方法。
// 焦点循环与背景不可聚焦由浏览器用例验证，这里只补「开」与「关」。
if (typeof HTMLDialogElement !== 'undefined') {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
    },
  });
}
