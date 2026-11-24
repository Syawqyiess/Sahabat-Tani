/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/**/*.ejs',
    './public/js/**/*.js'
  ],
  corePlugins: {
    preflight: false, // Jaga agar tidak merusak CSS reset bawaan Sahabat Tani
  },
  theme: {
    extend: {
      colors: {
        'forest-dark': '#061A10',
        'forest': '#0A2E1D',
        'forest-700': '#174628',
        'leaf': '#4E8A3E',
        'agri-lime': '#84C341',
        'sand': '#F5EFEA',
        'sage': '#F2F6F3',
        'charcoal': '#181C19',
        'moss': '#5C6660',
        'soil': '#8A5A35',
      },
      borderRadius: {
        'card': '18px',
        'section': '24px',
      },
      boxShadow: {
        'soft': '0 4px 20px rgba(10, 46, 29, 0.05)',
        'lift': '0 12px 32px rgba(10, 46, 29, 0.1)',
        'glass': '0 16px 36px rgba(0, 0, 0, 0.28)',
      }
    },
  },
  plugins: [],
};
