import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/scenario.css'
import './assets/administration.css'

createApp(App).use(createPinia()).mount('#app')
