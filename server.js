const express = require('express');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Функция парсинга Wildberries
async function parseWildberries(searchQuery) {
  let browser;
  
  try {
    // Запускаем браузер
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Устанавливаем User-Agent чтобы не блокировали
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Идем на страницу поиска WB
    const searchUrl = `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(searchQuery)}`;
    
    console.log('Переходим на:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Ждем загрузки товаров
    await page.waitForSelector('.product-card', { timeout: 15000 });
    
    // Парсим первые 3 товара
    const products = await page.evaluate(() => {
      const productCards = document.querySelectorAll('.product-card');
      const results = [];
      
      for (let i = 0; i < Math.min(3, productCards.length); i++) {
        const card = productCards[i];
        
        try {
          // Название товара
          const nameElement = card.querySelector('.product-card__name') || 
                             card.querySelector('[data-link]') ||
                             card.querySelector('.goods-name');
          const name = nameElement ? nameElement.textContent.trim() : 'Название не найдено';
          
          // Цена
          const priceElement = card.querySelector('.price__lower-price') ||
                              card.querySelector('.product-card__price') ||
                              card.querySelector('.lower-price');
          const price = priceElement ? priceElement.textContent.trim() : 'Цена не указана';
          
          // Ссылка на товар
          const linkElement = card.querySelector('a[href*="/catalog/"]') ||
                             card.querySelector('[data-link]');
          let link = 'Ссылка не найдена';
          if (linkElement) {
            const href = linkElement.getAttribute('href') || linkElement.getAttribute('data-link');
            if (href) {
              link = href.startsWith('http') ? href : `https://www.wildberries.ru${href}`;
            }
          }
          
          // Рейтинг (если есть)
          const ratingElement = card.querySelector('.product-card__rating') ||
                               card.querySelector('[class*="rating"]');
          const rating = ratingElement ? ratingElement.textContent.trim() : '';
          
          results.push({
            name: name,
            price: price,
            rating: rating,
            link: link
          });
          
        } catch (error) {
          console.log('Ошибка парсинга карточки:', error);
        }
      }
      
      return results;
    });

    await browser.close();
    
    return {
      success: true,
      search_query: searchQuery,
      found_total: products.length,
      products: products
    };
    
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    
    console.error('Ошибка парсинга:', error);
    
    return {
      success: false,
      error: error.message,
      search_query: searchQuery
    };
  }
}

// API endpoint для поиска
app.post('/search', async (req, res) => {
  const { search_query } = req.body;
  
  if (!search_query) {
    return res.status(400).json({ 
      success: false, 
      error: 'Поисковый запрос не указан' 
    });
  }
  
  console.log('Получен запрос на поиск:', search_query);
  
  const result = await parseWildberries(search_query);
  res.json(result);
});

// Проверка работы сервиса
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'WB Parser',
    timestamp: new Date().toISOString() 
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WB Parser сервис запущен на порту ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Search API: POST http://localhost:${PORT}/search`);
});
