const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

// 1. Load env variables from .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=');
        if (index !== -1) {
          const key = trimmed.substring(0, index).trim();
          const value = trimmed.substring(index + 1).trim();
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnv();

const apiKey = process.env.TRELLO_API_KEY;
const token = process.env.TRELLO_TOKEN;
const boardId = process.env.TRELLO_BOARD_ID;

if (!apiKey || !token || !boardId) {
  console.error('Error: Faltan credenciales de Trello en .env.local.');
  console.error('Asegúrate de tener TRELLO_API_KEY, TRELLO_TOKEN y TRELLO_BOARD_ID configurados.');
  process.exit(1);
}

// 2. Helper to perform HTTP Requests using native 'https' module
function apiCall(method, apiPath, queryParams = {}, postData = null) {
  return new Promise((resolve, reject) => {
    // Append credentials to query params
    const fullParams = { key: apiKey, token: token, ...queryParams };
    const queryString = querystring.stringify(fullParams);
    const url = `https://api.trello.com/1${apiPath}?${queryString}`;
    const urlObj = new URL(url);

    const options = {
      method: method,
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {}
    };

    let bodyData = '';
    if (postData) {
      bodyData = querystring.stringify(postData);
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseBody));
          } catch (e) {
            resolve(responseBody);
          }
        } else {
          reject(new Error(`Trello API Error (${res.statusCode}): ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(bodyData);
    }
    req.end();
  });
}

// 3. Main CLI Logic
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ? args[0].toLowerCase() : 'help';

  try {
    switch (command) {
      case 'list':
        await listBoard(args[1]);
        break;
      case 'add':
        await addCard(args[1], args[2], args[3]);
        break;
      case 'move':
        await moveCard(args[1], args[2]);
        break;
      case 'comment':
        await addComment(args[1], args[2]);
        break;
      case 'archive':
        await archiveCard(args[1]);
        break;
      case 'help':
      default:
        printHelp();
        break;
    }
  } catch (err) {
    console.error('\n❌ Error:', err.message);
  }
}

function printHelp() {
  console.log(`
🛠️  Trello CLI Helper - SellAlleS Web
Uso: node trello.js <comando> [argumentos]

Comandos disponibles:
  list [nombre_columna]
    Lista todas las columnas y tarjetas, o filtra por una columna específica.
    Ej: node trello.js list
    Ej: node trello.js list "Bugs"

  add "<columna>" "<titulo>" "[descripcion]"
    Agrega una nueva tarjeta en la columna indicada.
    Ej: node trello.js add "Por hacer" "Corregir padding del header" "El padding se ve raro en móviles"

  move "<id_tarjeta o titulo_tarjeta>" "<columna_destino>"
    Mueve una tarjeta de una columna a otra (búsqueda inteligente por título).
    Ej: node trello.js move "Corregir padding del header" "Enproceso"

  comment "<id_tarjeta o titulo_tarjeta>" "<comentario>"
    Añade un comentario a la tarjeta.
    Ej: node trello.js comment "Corregir padding" "He revisado el CSS en Safari"

  archive "<id_tarjeta o titulo_tarjeta>"
    Archiva (cierra) la tarjeta especificada.
    Ej: node trello.js archive "Corregir padding"
  `);
}

// Fetch lists and cards helper
async function getListsAndCards() {
  const [lists, cards] = await Promise.all([
    apiCall('GET', `/boards/${boardId}/lists`),
    apiCall('GET', `/boards/${boardId}/cards`)
  ]);
  return { lists, cards };
}

// Find a list by name (fuzzy) or ID
function findList(lists, searchTerm) {
  if (!searchTerm) return null;
  const lowerSearch = searchTerm.toLowerCase();
  
  // Direct ID check
  const listById = lists.find(l => l.id === searchTerm);
  if (listById) return listById;

  // Exact or prefix match
  const matches = lists.filter(l => l.name.toLowerCase().includes(lowerSearch));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Se encontraron múltiples columnas que coinciden con "${searchTerm}": ${matches.map(m => m.name).join(', ')}`);
  }
  return null;
}

// Find a card by title (fuzzy, only active cards) or ID
function findCard(cards, searchTerm) {
  if (!searchTerm) return null;
  const lowerSearch = searchTerm.toLowerCase();

  // Direct ID check
  const cardById = cards.find(c => c.id === searchTerm);
  if (cardById) return cardById;

  // Exact or fuzzy title match
  const matches = cards.filter(c => c.name.toLowerCase().includes(lowerSearch));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Se encontraron múltiples tarjetas que coinciden con "${searchTerm}":\n` + 
      matches.map(m => `  - ID: ${m.id} | Titulo: "${m.name}"`).join('\n')
    );
  }
  if (matches.length === 0) {
    throw new Error(`No se encontró ninguna tarjeta con el título o ID "${searchTerm}".`);
  }
  return matches[0];
}

async function listBoard(filterList) {
  const { lists, cards } = await getListsAndCards();
  
  console.log('\n--- TABLERO: SellAlleS Web ---');
  
  const cardsByList = {};
  lists.forEach(l => cardsByList[l.id] = []);
  cards.forEach(c => {
    if (cardsByList[c.idList]) {
      cardsByList[c.idList].push(c);
    }
  });

  let targetLists = lists;
  if (filterList) {
    const list = findList(lists, filterList);
    if (!list) {
      console.log(`❌ Columna "${filterList}" no encontrada.`);
      return;
    }
    targetLists = [list];
  }

  targetLists.forEach(list => {
    const listCards = cardsByList[list.id] || [];
    console.log(`\n📌 [${list.name}] (${listCards.length} tarjetas) - ID: ${list.id}`);
    if (listCards.length === 0) {
      console.log('  (Vacío)');
    } else {
      listCards.forEach(c => {
        console.log(`  - [${c.name}] (ID: ${c.id})`);
        if (c.desc) {
          const firstLine = c.desc.split('\n')[0];
          console.log(`    └─ Desc: ${firstLine.substring(0, 60)}${firstLine.length > 60 ? '...' : ''}`);
        }
      });
    }
  });
}

async function addCard(columnName, title, description = '') {
  if (!columnName || !title) {
    console.error('❌ Error: Faltan argumentos. Uso: node trello.js add "<columna>" "<titulo>" "[descripcion]"');
    return;
  }

  const { lists } = await getListsAndCards();
  const list = findList(lists, columnName);
  if (!list) {
    throw new Error(`No se encontró la columna "${columnName}". Columnas disponibles: ${lists.map(l => l.name).join(', ')}`);
  }

  console.log(`Añadiendo tarjeta a la columna [${list.name}]...`);
  const newCard = await apiCall('POST', '/cards', {}, {
    idList: list.id,
    name: title,
    desc: description
  });

  console.log(`\n✅ Tarjeta creada con éxito!`);
  console.log(`ID: ${newCard.id}`);
  console.log(`Título: "${newCard.name}"`);
  console.log(`Enlace: ${newCard.shortUrl}`);
}

async function moveCard(cardSearch, targetColumnName) {
  if (!cardSearch || !targetColumnName) {
    console.error('❌ Error: Faltan argumentos. Uso: node trello.js move "<tarjeta>" "<columna_destino>"');
    return;
  }

  const { lists, cards } = await getListsAndCards();
  
  const card = findCard(cards, cardSearch);
  const targetList = findList(lists, targetColumnName);

  if (!targetList) {
    throw new Error(`No se encontró la columna de destino "${targetColumnName}". Columnas disponibles: ${lists.map(l => l.name).join(', ')}`);
  }

  console.log(`Moviendo tarjeta "${card.name}" a [${targetList.name}]...`);
  await apiCall('PUT', `/cards/${card.id}`, { idList: targetList.id });
  console.log(`✅ Movida con éxito!`);
}

async function addComment(cardSearch, commentText) {
  if (!cardSearch || !commentText) {
    console.error('❌ Error: Faltan argumentos. Uso: node trello.js comment "<tarjeta>" "<comentario>"');
    return;
  }

  const { cards } = await getListsAndCards();
  const card = findCard(cards, cardSearch);

  console.log(`Añadiendo comentario a la tarjeta "${card.name}"...`);
  await apiCall('POST', `/cards/${card.id}/actions/comments`, { text: commentText });
  console.log(`✅ Comentario añadido!`);
}

async function archiveCard(cardSearch) {
  if (!cardSearch) {
    console.error('❌ Error: Falta argumento. Uso: node trello.js archive "<tarjeta>"');
    return;
  }

  const { cards } = await getListsAndCards();
  const card = findCard(cards, cardSearch);

  console.log(`Archivando tarjeta "${card.name}"...`);
  await apiCall('PUT', `/cards/${card.id}`, { closed: true });
  console.log(`✅ Tarjeta archivada!`);
}

main();
