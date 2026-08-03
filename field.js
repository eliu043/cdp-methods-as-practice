(() => {
  const clusters = {
    material:       { title: 'Material',               x: 180,  y: 230,  w: 900,  h: 900 },
    indexing:       { title: 'Indexing',               x: 1320, y: 80,   w: 780,  h: 820 },
    infrastructure: { title: 'Infrastructure',         x: 240,  y: 1390, w: 1040, h: 1450 },
    mapping:        { title: 'Mapping',                x: 1280, y: 1030, w: 860,  h: 900 },
    sensors:        { title: 'Sensor / Input',         x: 2250, y: 320,  w: 930,  h: 950 },
    codes:          { title: 'Codes / Metric',         x: 3260, y: 160,  w: 1050, h: 1320 },
    games:          { title: 'Game Theory',            x: 4360, y: 420,  w: 850,  h: 900 },
    media:          { title: 'Media / Representation', x: 1550, y: 2050, w: 1680, h: 1100 },
    capital:        { title: 'Capital',                x: 3450, y: 1760, w: 1500, h: 1240 }
  };

  const resources = [
    ['dust-to-light','material','Dust to Light','Azra Akšamija','https://www.azraaksamija.com/project/staub-zu-licht',90,150,520],
    ['anatomy','indexing','Anatomy of an AI System','Kate Crawford & Vladan Joler','https://anatomyof.ai',80,130,480],
    ['extrastatecraft','infrastructure','Extrastatecraft','Keller Easterling','https://www.kellereasterling.com/books/extrastatecraft-the-power-of-infrastructure-space',40,130,420],
    ['super-mega','infrastructure','Super-Mega-Ruralistic','Smout Allen','https://www.smoutallen.com/super-mega-ruralistic',540,220,390],
    ['landing-sites','infrastructure','Landing Sites','Trevor Paglen','https://paglen.studio/2020/04/09/landing-sites/',130,580,430],
    ['pink-cell-tower','infrastructure','Pink Cell Tower','Julian Oliver','https://julianoliver.com/projects/pink-cell-tower/',590,720,370],
    ['cosmos-quipus','mapping','Cosmos, Computers and Quipus','Marina Otero Verzier & Locument','https://www.koozarch.com/interviews/cosmos-computers-and-quipus-marina-otero-and-locument',65,150,500],
    ['groundwater-earth','sensors','Groundwater Earth','Anthony Acciavatti','https://soa.utexas.edu/events/anthony-acciavatti-somatic-collaborative',60,150,500],
    ['missing-datasets','codes','The Library of Missing Datasets','Mimi Onuoha','https://mimi-onuoha-9s0o.squarespace.com/the-library-of-missing-datasets',40,130,440],
    ['rotterdam-risk','codes','Rotterdam Risk Scores','Lav.io','https://lav.io/projects/rotterdam-risk-score/',540,220,430],
    ['houston-variations','codes','Houston Variations','HOME-OFFICE','https://www.home-office.co/houston-variations',240,650,460],
    ['holo-3','codes','HOLO 3','HOLO','https://www.holo.mg/shop/holo-3/',560,840,380],
    ['minga','games','Minga','Jose Sanchez','https://www.plethora-project.com/minga',80,150,500],
    ['poor-image','media','In Defense of the Poor Image','Hito Steyerl','https://www.e-flux.com/journal/10/61362/in-defense-of-the-poor-image',30,150,390],
    ['cloud-studies','media','Cloud Studies','Forensic Architecture','https://forensic-architecture.org/investigation/cloudstudies',470,260,420,'images/cloud-studies-installation.png'],
    ['unfinished-monument','media','I will not find this image beautiful','Omar Mismar · 2015','https://www.omarmismar.com/i-will-not-find-this-image-beautiful',690,650,500,'images/i-will-not-find-this-image-beautiful.png'],
    ['operational-images','media','Operational Images','Jussi Parikka','https://www.upress.umn.edu/9781517912116/operational-images/',960,120,350],
    ['ultramoderne','media','Projects','Ultramoderne','https://www.ultramoderne.net/projects.php',1240,500,370],
    ['get-to-zero','capital','How to Get to Zero','Tega Brain & Sam Lavigne','https://tegabrain.com/How-to-Get-to-Zero-exhibition',50,140,440],
    ['ai-toys','capital','A.I. Toys (screens)','Ani Liu','https://ani-liu.com/ai-toys-screens',560,230,410],
    ['library-cloud','capital','Cloud Studies: Investigative Aesthetics','Forensic Architecture','https://forensic-architecture.org/investigation/cloudstudies',1030,600,400,'images/cloud-studies-installation.png']
  ].map(([id,cluster,title,author,url,x,y,w,image]) => ({id,cluster,title,author,url,x,y,w,image}));

  const viewport = document.getElementById('fieldViewport');
  const world = document.getElementById('fieldWorld');
  const zoomLevel = document.getElementById('zoomLevel');
  const sections = {};

  Object.entries(clusters).forEach(([id, data]) => {
    const section = document.createElement('section');
    section.className = 'cluster';
    section.dataset.cluster = id;
    section.style.cssText = `--x:${data.x}px;--y:${data.y}px;--w:${data.w}px;--h:${data.h}px`;
    section.innerHTML = `<h1>${data.title}</h1>`;
    world.appendChild(section);
    sections[id] = section;
  });

  resources.forEach((resource) => {
    const card = document.createElement('article');
    card.className = 'resource-card';
    card.dataset.cardId = resource.id;
    card.style.cssText = `--x:${resource.x}px;--y:${resource.y}px;--w:${resource.w}px`;
    const shot = resource.image || `https://image.thum.io/get/width/900/crop/650/noanimate/${resource.url}`;
    card.innerHTML = `
      <img src="${shot}" alt="" draggable="false" loading="lazy">
      <div class="card-meta">
        <div><h2>${resource.title}</h2><p>${resource.author}</p></div>
        <a href="${resource.url}" target="_blank" rel="noreferrer" aria-label="Open ${resource.title}">↗</a>
      </div>`;
    sections[resource.cluster].appendChild(card);
  });

  const minScale = .18;
  const maxScale = 1.2;
  const state = { x: 0, y: 0, scale: .4 };
  let interaction = null;

  function applyTransform() {
    world.style.transform = `translate3d(${state.x}px,${state.y}px,0) scale(${state.scale})`;
    zoomLevel.value = `${Math.round(state.scale * 100)}%`;
    zoomLevel.textContent = zoomLevel.value;
  }

  function fitField() {
    state.scale = Math.max(minScale, Math.min(.52, viewport.clientWidth / 5400, viewport.clientHeight / 3200));
    state.x = (viewport.clientWidth - 5400 * state.scale) / 2;
    state.y = (viewport.clientHeight - 3200 * state.scale) / 2;
    applyTransform();
  }

  function zoomAt(nextScale, clientX = viewport.clientWidth / 2, clientY = viewport.clientHeight / 2) {
    nextScale = Math.max(minScale, Math.min(maxScale, nextScale));
    const rect = viewport.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const worldX = (pointerX - state.x) / state.scale;
    const worldY = (pointerY - state.y) / state.scale;
    state.x = pointerX - worldX * nextScale;
    state.y = pointerY - worldY * nextScale;
    state.scale = nextScale;
    applyTransform();
  }

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(state.scale * (event.deltaY > 0 ? .9 : 1.1), event.clientX, event.clientY);
  }, {passive:false});

  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('a,button')) return;
    const card = event.target.closest('.resource-card');
    viewport.setPointerCapture(event.pointerId);
    if (card) {
      interaction = {type:'card',card,startX:event.clientX,startY:event.clientY,left:card.offsetLeft,top:card.offsetTop};
      card.classList.add('is-dragging');
    } else {
      interaction = {type:'pan',startX:event.clientX,startY:event.clientY,x:state.x,y:state.y};
      viewport.classList.add('is-panning');
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!interaction) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    if (interaction.type === 'pan') {
      state.x = interaction.x + dx;
      state.y = interaction.y + dy;
      applyTransform();
    } else {
      interaction.card.style.left = `${interaction.left + dx / state.scale}px`;
      interaction.card.style.top = `${interaction.top + dy / state.scale}px`;
    }
  });

  function endInteraction() {
    if (!interaction) return;
    if (interaction.type === 'card') {
      interaction.card.classList.remove('is-dragging');
      saveCards();
    }
    viewport.classList.remove('is-panning');
    interaction = null;
  }
  viewport.addEventListener('pointerup', endInteraction);
  viewport.addEventListener('pointercancel', endInteraction);

  function saveCards() {
    const positions = {};
    document.querySelectorAll('.resource-card').forEach((card) => {
      positions[card.dataset.cardId] = {left:card.style.left,top:card.style.top};
    });
    localStorage.setItem('lots-field-v1', JSON.stringify(positions));
  }

  function restoreCards() {
    try {
      const positions = JSON.parse(localStorage.getItem('lots-field-v1') || '{}');
      document.querySelectorAll('.resource-card').forEach((card) => {
        if (positions[card.dataset.cardId]?.left) card.style.left = positions[card.dataset.cardId].left;
        if (positions[card.dataset.cardId]?.top) card.style.top = positions[card.dataset.cardId].top;
      });
    } catch (_) { localStorage.removeItem('lots-field-v1'); }
  }

  document.getElementById('zoomIn').addEventListener('click', () => zoomAt(state.scale * 1.2));
  document.getElementById('zoomOut').addEventListener('click', () => zoomAt(state.scale / 1.2));
  document.getElementById('fitField').addEventListener('click', fitField);
  document.getElementById('resetCards').addEventListener('click', () => {
    localStorage.removeItem('lots-field-v1');
    document.querySelectorAll('.resource-card').forEach((card) => { card.style.left = ''; card.style.top = ''; });
    fitField();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '=' || event.key === '+') zoomAt(state.scale * 1.15);
    if (event.key === '-') zoomAt(state.scale / 1.15);
    if (event.key === '0') fitField();
  });
  restoreCards();
  fitField();
  window.addEventListener('resize', fitField);
})();
