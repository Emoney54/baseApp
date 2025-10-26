// ---------- Utils ----------
const $ = (id) => document.getElementById(id);
const shorten = (a) => a ? a.slice(0,6)+'...'+a.slice(-4) : '';
function setStatus(el, msg, type='info'){ el.textContent = msg||''; el.className = 'status ' + (type||''); }
function formatChain(id){ 
  if(id===8453) return 'Base';
  if(id===84532) return 'Base Sepolia';
  if(id===10) return 'Optimism';
  if(id===420) return 'Optimism Goerli';
  return 'Chain '+id;
}

// Configuration des réseaux
const NETWORKS = {
  8453: { name: 'Base Mainnet', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
  84532: { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' },
  10: { name: 'Optimism', rpc: 'https://optimism-mainnet.infura.io/v3/', explorer: 'https://optimistic.etherscan.io' },
  420: { name: 'Optimism Goerli', rpc: 'https://optimism-goerli.infura.io/v3/', explorer: 'https://goerli-optimism.etherscan.io' }
};

$('year').textContent = new Date().getFullYear();

// ---------- Wallet Integration ----------
let provider, signer, account;
async function ensureProvider(){
  if(provider) return provider;
  if(window.ethereum){
    provider = new window.ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = await provider.getSigner();
    account = (await provider.send('eth_accounts', []))[0];
    return provider;
  }
  throw new Error('No wallet connected. Please connect your wallet first.');
}


// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabpanel').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---------- IDE (Monaco + solc + ethers) ----------
let editor, lastCompile = { abi:null, bytecode:null, name:null };

require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.50.0/min/vs' }});
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor'), {
    value: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;
    event Increment(address indexed caller, uint256 newCount);
    function inc() external {
        count += 1;
        emit Increment(msg.sender, count);
    }
}`,
    language: 'solidity',
    theme: 'vs-dark',
    automaticLayout: true, fontSize: 14, minimap: { enabled: false }
  });
});

// Templates de contrats
const TEMPLATES = {
  vesting: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
}

contract TokenVesting {
    address public token;
    address public beneficiary;
    uint256 public vestingPeriod;
    uint256 public vestingStart;
    uint256 public released;
    mapping(address => uint256) private _released;
    
    event TokensReleased(address token, uint256 amount);
    
    constructor(address _token, address _beneficiary, uint256 _period) {
        token = _token;
        beneficiary = _beneficiary;
        vestingPeriod = _period;
        vestingStart = block.timestamp;
    }
    
    function release() public {
        uint256 releasable = vestedAmount() - released;
        require(releasable > 0, "Nothing to release");
        
        released += releasable;
        require(IERC20(token).transfer(beneficiary, releasable));
        emit TokensReleased(token, releasable);
    }
    
    function vestedAmount() public view returns (uint256) {
        uint256 totalVested = totalVestedAmount();
        return totalVested > released ? totalVested : released;
    }
    
    function totalVestedAmount() internal view returns (uint256) {
        uint256 elapsed = block.timestamp - vestingStart;
        if (elapsed >= vestingPeriod) {
            return IERC20(token).balanceOf(address(this)) + released;
        }
        return (elapsed * (IERC20(token).balanceOf(address(this)) + released)) / vestingPeriod;
    }
}`,
  
  vault: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Vault {
    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public lastDeposit;
    uint256 public constant REWARD_RATE = 3; // 3% APR
    uint256 private constant YEAR = 365 days;
    
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    constructor() {
        owner = msg.sender;
    }
    
    function deposit() external payable {
        require(msg.value > 0, "Must deposit some ETH");
        balances[msg.sender] += msg.value;
        lastDeposit[msg.sender] = block.timestamp;
        emit Deposited(msg.sender, msg.value);
    }
    
    function withdraw() external {
        uint256 userBalance = balances[msg.sender];
        require(userBalance > 0, "No balance");
        
        balances[msg.sender] = 0;
        payable(msg.sender).transfer(userBalance);
        emit Withdrawn(msg.sender, userBalance);
    }
    
    function claimRewards() external returns (uint256) {
        uint256 rewards = calculateRewards(msg.sender);
        require(rewards > 0, "No rewards available");
        
        balances[msg.sender] += rewards;
        lastDeposit[msg.sender] = block.timestamp;
        emit RewardsClaimed(msg.sender, rewards);
        return rewards;
    }
    
    function calculateRewards(address user) public view returns (uint256) {
        if (balances[user] == 0) return 0;
        uint256 timeElapsed = block.timestamp - lastDeposit[user];
        return (balances[user] * REWARD_RATE * timeElapsed) / (100 * YEAR);
    }
}`,
  
  multisig: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    uint256 public transactionCount;
    
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }
    
    event Submission(uint256 indexed transactionId);
    event Confirmation(address indexed sender, uint256 indexed transactionId);
    event Execution(uint256 indexed transactionId);
    event Deposit(address indexed sender, uint256 value);
    
    modifier onlyOwner() {
        require(isOwner(msg.sender), "Not an owner");
        _;
    }
    
    modifier transactionExists(uint256 _transactionId) {
        require(transactions[_transactionId].to != address(0), "Transaction doesn't exist");
        _;
    }
    
    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "Owners required");
        require(_required > 0 && _required <= _owners.length, "Invalid required number");
        owners = _owners;
        required = _required;
    }
    
    function isOwner(address _address) private view returns (bool) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == _address) return true;
        }
        return false;
    }
    
    function submitTransaction(address _to, uint256 _value, bytes memory _data) public onlyOwner returns (uint256) {
        uint256 transactionId = transactionCount;
        transactions[transactionId] = Transaction({
            to: _to,
            value: _value,
            data: _data,
            executed: false
        });
        transactionCount++;
        emit Submission(transactionId);
        confirmTransaction(transactionId);
        return transactionId;
    }
    
    function confirmTransaction(uint256 _transactionId) public onlyOwner transactionExists(_transactionId) {
        confirmations[_transactionId][msg.sender] = true;
        emit Confirmation(msg.sender, _transactionId);
        executeTransaction(_transactionId);
    }
    
    function executeTransaction(uint256 _transactionId) public {
        Transaction storage txn = transactions[_transactionId];
        require(!txn.executed, "Already executed");
        if (isConfirmed(_transactionId)) {
            txn.executed = true;
            (bool success,) = txn.to.call{value: txn.value}(txn.data);
            require(success, "Execution failed");
            emit Execution(_transactionId);
        }
    }
    
    function isConfirmed(uint256 _transactionId) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[_transactionId][owners[i]]) count++;
            if (count == required) return true;
        }
        return false;
    }
    
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
}`,
  
  marketplace: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Marketplace {
    struct Item {
        uint256 id;
        address seller;
        uint256 price;
        bool sold;
    }
    
    Item[] public items;
    mapping(uint256 => Item) public itemById;
    uint256 private itemIdCounter;
    
    event ItemListed(uint256 indexed id, address indexed seller, uint256 price);
    event ItemPurchased(uint256 indexed id, address indexed buyer);
    
    function listItem(uint256 _price) public {
        itemIdCounter++;
        Item memory newItem = Item({
            id: itemIdCounter,
            seller: msg.sender,
            price: _price,
            sold: false
        });
        itemById[itemIdCounter] = newItem;
        emit ItemListed(itemIdCounter, msg.sender, _price);
    }
    
    function purchaseItem(uint256 _itemId) public payable {
        Item storage item = itemById[_itemId];
        require(!item.sold, "Item already sold");
        require(msg.value >= item.price, "Insufficient payment");
        require(msg.sender != item.seller, "Cannot buy own item");
        
        item.sold = true;
        payable(item.seller).transfer(item.price);
        if (msg.value > item.price) {
            payable(msg.sender).transfer(msg.value - item.price);
        }
        emit ItemPurchased(_itemId, msg.sender);
    }
    
    function getItemsCount() public view returns (uint256) {
        return itemIdCounter;
    }
}`,
  
  payment: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PaymentSplitter {
    address[] public payees;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalReleased;
    mapping(address => uint256) public released;
    
    event PaymentReleased(address indexed to, uint256 amount);
    
    constructor(address[] memory _payees, uint256[] memory _shares) {
        require(_payees.length == _shares.length, "Length mismatch");
        for (uint256 i = 0; i < _payees.length; i++) {
            addPayee(_payees[i], _shares[i]);
        }
    }
    
    function addPayee(address _payee, uint256 _share) private {
        require(_payee != address(0), "Zero address");
        require(_share > 0, "Zero share");
        require(shares[_payee] == 0, "Already a payee");
        
        payees.push(_payee);
        shares[_payee] = _share;
        totalShares += _share;
    }
    
    function release(address _payee) public {
        require(shares[_payee] > 0, "Payee has no shares");
        
        uint256 totalReceived = address(this).balance + totalReleased;
        uint256 payment = (totalReceived * shares[_payee]) / totalShares - released[_payee];
        
        require(payment != 0, "Nothing to release");
        released[_payee] += payment;
        totalReleased += payment;
        
        payable(_payee).transfer(payment);
        emit PaymentReleased(_payee, payment);
    }
    
    function releaseAll() public {
        for (uint256 i = 0; i < payees.length; i++) {
            release(payees[i]);
        }
    }
}`,
  
  factory: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TokenFactory {
    address[] public tokens;
    mapping(address => address) public tokenToOwner;
    
    event TokenCreated(address indexed token, address indexed owner);
    
    function createToken(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) public returns (address) {
        Token newToken = new Token(name, symbol, initialSupply, msg.sender);
        address tokenAddress = address(newToken);
        tokens.push(tokenAddress);
        tokenToOwner[tokenAddress] = msg.sender;
        emit TokenCreated(tokenAddress, msg.sender);
        return tokenAddress;
    }
    
    function getTokensCount() public view returns (uint256) {
        return tokens.length;
    }
}

contract Token {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint256 _supply, address _owner) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply * 10**decimals;
        balanceOf[_owner] = totalSupply;
    }
    
    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
    
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }
}`
};

// Gérer les clicks sur les templates
document.querySelectorAll('.template-card').forEach(card => {
  card.addEventListener('click', ()=> {
    const template = card.dataset.template;
    if(TEMPLATES[template]) {
      editor?.setValue(TEMPLATES[template]);
    }
  });
});

function openInRemix(){
  const code = editor.getValue();
  const url = 'https://remix.ethereum.org/#code=' + encodeURIComponent(code);
  $('btnRemix').href = url;
}

async function compileSolidity(){
  try{
    const code = editor.getValue();
    const input = {
      language: 'Solidity',
      sources: { 'Contract.sol': { content: code } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { '*': { '*': ['abi','evm.bytecode','metadata'] } }
      }
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if(output.errors){
      const errs = output.errors.filter(e=>e.severity!=='warning').map(e=>e.formattedMessage).join('\n');
      if(errs.length){ setStatus($('compileStatus'), errs, 'err'); return; }
    }
    const src = Object.keys(output.contracts)[0];
    const name = Object.keys(output.contracts[src])[0];
    const data = output.contracts[src][name];
    const abi = data.abi;
    const bytecode = data.evm.bytecode.object;

    lastCompile = { abi, bytecode: bytecode.startsWith('0x')?bytecode:('0x'+bytecode), name };
    $('contractName').value = name;
    $('abiOut').value = JSON.stringify(abi, null, 2);
    $('bytecodeOut').value = lastCompile.bytecode;
    setStatus($('compileStatus'), 'Compilation OK ✅', 'ok');
    openInRemix();
  }catch(e){ setStatus($('compileStatus'), 'Erreur: ' + (e.message||e), 'err'); }
}
$('btnCompile').addEventListener('click', compileSolidity);

async function deployNow(){
  const status = $('deployStatus');
  try{
    if(!lastCompile.abi || !lastCompile.bytecode){ throw new Error('Compile d’abord pour obtenir ABI/bytecode.'); }
    await ensureProvider();
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();

    let args = [];
    const raw = $('ctorArgs').value.trim();
    if(raw.length){
      try{ args = JSON.parse('['+raw+']'); } catch { args = raw.split(',').map(s=>s.trim()); }
    }
    const overrides = {};
    const v = $('deployValue').value.trim();
    if(v && Number(v)>0){ overrides.value = window.ethers.parseEther(v); }

    const factory = new window.ethers.ContractFactory(lastCompile.abi, lastCompile.bytecode, signer);
    const contract = await factory.deploy(...args, overrides);
    setStatus(status, 'Déploiement envoyé. Hash: ' + contract.deploymentTransaction().hash, 'ok');
    const deployed = await contract.waitForDeployment();
    setStatus(status, 'Déployé à: ' + await deployed.getAddress(), 'ok');
  }catch(e){ setStatus(status, 'Erreur: ' + (e.message||e), 'err'); }
}
$('btnDeploy').addEventListener('click', deployNow);
$('deployBtn').addEventListener('click', deployNow);
$('btnRemix').addEventListener('click', openInRemix);

// ---------- Social (local feed) ----------
const FEED_KEY = 'baselearn_feed_v1';
function loadFeed(){ try{ return JSON.parse(localStorage.getItem(FEED_KEY)||'[]'); }catch{ return []; } }
function saveFeed(arr){ localStorage.setItem(FEED_KEY, JSON.stringify(arr)); }
function renderFeed(){
  const feed = loadFeed();
  const box = $('feed'); box.innerHTML = '';
  if(feed.length===0){ box.innerHTML = '<p class="muted">Aucun post pour l’instant.</p>'; return; }
  for(const p of feed.slice().reverse()){
    const el = document.createElement('div');
    el.className = 'feed-card';
    el.innerHTML = `
      <div class="title">${p.address ? shorten(p.address) : 'Contrat'}</div>
      <div class="meta">par ${shorten(p.author||'0x0')} • ${new Date(p.ts).toLocaleString()}</div>
      <div class="note">${(p.note||'').replaceAll('<','&lt;')}</div>
      ${p.address ? `<div class="meta">Adresse: ${p.address}</div>`:''}
      ${p.abi ? `<details class="meta"><summary>ABI</summary><pre>${p.abi}</pre></details>`:''}
    `;
    box.appendChild(el);
  }
}
renderFeed();

$('shareBtn').addEventListener('click', async ()=>{
  try{
    await ensureProvider(); await provider.send('eth_requestAccounts', []);
    const acc = (await provider.send('eth_accounts', []))[0];
    const address = $('shareAddress').value.trim();
    const abi = $('shareAbi').value.trim();
    const note = $('shareNote').value.trim();
    if(!address && !note) throw new Error('Ajoute au moins une adresse ou une note.');
    const feed = loadFeed();
    feed.push({ address, abi, note, author: acc, ts: Date.now() });
    saveFeed(feed); renderFeed();
    setStatus($('shareStatus'), 'Publié dans le feed ✅', 'ok');
    $('shareAddress').value=''; $('shareAbi').value=''; $('shareNote').value='';
  }catch(e){ setStatus($('shareStatus'), e.message||String(e), 'err'); }
});

// ---------- Dashboard (GM / Prediction / XP) ----------
const XP_KEY = 'baselearn_xp_v1';
function loadXP(){ try{ return JSON.parse(localStorage.getItem(XP_KEY)||'{"xp":0,"gmDates":[],"preds":[]}'); }catch{ return {xp:0,gmDates:[],preds:[]}; } }
function saveXP(x){ localStorage.setItem(XP_KEY, JSON.stringify(x)); }
function todayStr(){ const d = new Date(); return d.toISOString().slice(0,10); }

function renderProgress(){
  const x = loadXP();
  const streak = calcStreak(x.gmDates);
  $('progressOut').textContent =
`XP total: ${x.xp}
GM streak: ${streak} jour(s)
GM faits: ${x.gmDates.length}
Prédictions: ${x.preds.length}`;
}
function calcStreak(days){
  // simple streak sur GM du jour
  if(days.length===0) return 0;
  const sorted = days.slice().sort();
  let streak = 0;
  let d = new Date(sorted[sorted.length-1]);
  const today = todayStr();
  if(sorted[sorted.length-1] !== today) return 0;
  while(sorted.includes(d.toISOString().slice(0,10))){
    streak++;
    d.setDate(d.getDate()-1);
  }
  return streak;
}
renderProgress();

$('gmBtn').addEventListener('click', ()=>{
  const x = loadXP(); const t = todayStr();
  if(!x.gmDates.includes(t)){ x.gmDates.push(t); x.xp += 5; saveXP(x); setStatus($('gmStatus'),'GM envoyé ✅ (+5 XP)','ok'); }
  else { setStatus($('gmStatus'),'Déjà fait aujourd’hui','info'); }
  renderProgress();
});

document.querySelectorAll('[data-pred]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const dir = btn.dataset.pred; const asset = $('predAsset').value;
    const x = loadXP(); const t = todayStr();
    if(x.preds.find(p=>p.day===t && p.asset===asset)){ setStatus($('predStatus'),'Déjà fait pour aujourd’hui','info'); return; }
    x.preds.push({ day:t, asset, dir }); x.xp += 3; saveXP(x);
    setStatus($('predStatus'),`Prédiction ${asset}: ${dir==='up'?'UP':'DOWN'} ✅ (+3 XP)`, 'ok');
    renderProgress();
  });
});

// ---------- Wallet Connection ----------
// API Basescan pour récupérer les données
const BASESCAN_API = 'https://api.basescan.org/api';

async function fetchWalletStats(address, chainId){
  try{
    // Déterminer l'URL de l'API selon le réseau
    let apiUrl = BASESCAN_API;
    if(chainId === 84532){
      apiUrl = 'https://api-sepolia.basescan.org/api';
    } else if(chainId === 10 || chainId === 420){
      // Pour Optimism, on va juste récupérer le compte depuis le provider
      if(provider){
        const txCount = await provider.getTransactionCount(address, 'latest');
        return { txCount, balanceWei: '0' };
      }
      return { txCount: 0, balanceWei: '0' };
    }
    
    // Récupérer le nombre de transactions
    const txCountRes = await fetch(`${apiUrl}?module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest`);
    const txCountData = await txCountRes.json();
    const txCount = txCountData.result ? parseInt(txCountData.result, 16) : 0;
    
    // Récupérer le solde
    const balanceRes = await fetch(`${apiUrl}?module=account&action=balance&address=${address}&tag=latest`);
    const balanceData = await balanceRes.json();
    const balanceWei = balanceData.result ? balanceData.result : '0';
    
    return { txCount, balanceWei };
  }catch(e){
    console.error('Erreur récupération stats:', e);
    return { txCount: 0, balanceWei: '0' };
  }
}

async function loadWalletTokens(){
  if(!account || !provider) return [];
  
  try{
    const tokenList = $('tokenList');
    tokenList.innerHTML = '<p class="loading">Chargement des tokens...</p>';
    
    // Retourner juste le solde ETH comme principal token
    const balance = await provider.getBalance(account);
    const balanceEth = window.ethers.formatEther(balance);
    
    const tokens = [{
      name: 'Ethereum',
      symbol: 'ETH',
      balance: balanceEth,
      decimals: 18
    }];
    
    return tokens;
  }catch(e){
    console.error('Erreur chargement tokens:', e);
    return [];
  }
}

function formatTokenAmount(amount, decimals){
  const num = Number(amount);
  if(num === 0) return '0';
  if(num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if(num >= 1000) return (num / 1000).toFixed(2) + 'K';
  if(num >= 1) return num.toFixed(4);
  return num.toFixed(6);
}

async function renderWalletTokens(){
  const tokenList = $('tokenList');
  if(!tokenList) return;
  
  const tokens = await loadWalletTokens();
  
  if(tokens.length === 0){
    tokenList.innerHTML = '<p class="loading">Aucun token trouvé</p>';
    return;
  }
  
  tokenList.innerHTML = '';
  for(const token of tokens){
    const item = document.createElement('div');
    item.className = 'token-item';
    
    // Formater le montant selon le type de token
    const formattedAmount = token.symbol === 'ETH' 
      ? formatTokenAmount(token.balance) 
      : formatTokenAmount(token.balance);
    
    item.innerHTML = `
      <div class="token-info">
        <div class="token-name">${token.name}</div>
        <div class="token-symbol">${token.symbol}</div>
      </div>
      <div class="token-amount">${formattedAmount}</div>
    `;
    tokenList.appendChild(item);
  }
}

function openSidebar(){
  const sidebar = $('profileSidebar');
  const overlay = $('sidebarOverlay');
  if(sidebar) sidebar.classList.add('active');
  if(overlay) overlay.classList.add('active');
}

function closeSidebar(){
  const sidebar = $('profileSidebar');
  const overlay = $('sidebarOverlay');
  if(sidebar) sidebar.classList.remove('active');
  if(overlay) overlay.classList.remove('active');
}

async function updateSidebarInfo(){
  if(!account || !provider) return;
  
  try{
    // Adresse
    $('sidebarAddress').textContent = account;
    
    // Solde
    const balance = await provider.getBalance(account);
    const balanceEth = window.ethers.formatEther(balance);
    $('sidebarBalance').textContent = `${Number(balanceEth).toFixed(4)} ETH`;
    
    // Réseau
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    $('sidebarNetwork').textContent = formatChain(chainId);
    
    // Nombre de transactions
    const stats = await fetchWalletStats(account, chainId);
    $('sidebarTxCount').textContent = `${stats.txCount.toLocaleString()} transactions`;
    
    // Charger les tokens
    await renderWalletTokens();
    
  }catch(e){
    console.error('Erreur mise à jour sidebar:', e);
  }
}

function showWalletInfo(){
  updateSidebarInfo();
  openSidebar();
}

function hideWalletInfo(){
  closeSidebar();
}

// Attendre que ethers soit disponible
function waitForEthers(){
  return new Promise((resolve)=>{
    if(typeof window.ethers !== 'undefined'){
      resolve();
      return;
    }
    const checkEthers = setInterval(()=>{
      if(typeof window.ethers !== 'undefined'){
        clearInterval(checkEthers);
        resolve();
      }
    }, 50);
    setTimeout(()=>{
      clearInterval(checkEthers);
      resolve(); // Continue même si ethers n'est pas disponible
    }, 3000);
  });
}

function initWalletConnection(){
  const btn = $('connectBtn');
  if(!btn) return;
  
  btn.addEventListener('click', async ()=>{
    // Si déjà connecté, ouvrir le sidebar
    if(btn.classList.contains('connected')){
      showWalletInfo();
      return;
    }
    
    try{
      await waitForEthers();
      
      if(!window.ethereum){ 
        alert('Aucun wallet détecté. Installe MetaMask d\'abord.');
        return;
      }
      
      // Vérifier que ethers est disponible
      if(typeof window.ethers === 'undefined'){
        alert('Ethers.js n\'est pas chargé. Rechargez la page.');
        console.error('ethers object:', typeof ethers, typeof window.ethers);
        return;
      }
      
      // Demande de connexion (ethers est maintenant disponible globalement)
      provider = new window.ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = await provider.getSigner();
      account = (await provider.send('eth_accounts', []))[0];
      
      // Mise à jour de l'UI
      btn.textContent = `Connected: ${shorten(account)}`;
      btn.classList.add('connected');
      
      // Récupération du réseau
      const net = await provider.getNetwork();
      const chainId = Number(net.chainId);
      $('networkBadge').textContent = `Réseau: ${formatChain(chainId)}`;
      
      // Ouvrir le sidebar avec les infos
      showWalletInfo();
      
      // Écouter les changements de compte/réseau
      window.ethereum.on('accountsChanged', ()=>{ location.reload(); });
      window.ethereum.on('chainChanged', ()=>{ location.reload(); });
      
    }catch(e){
      console.error('Erreur connexion:', e);
      alert('Erreur de connexion: ' + (e.message||e));
    }
  });
}

// Fonction de déconnexion
function disconnectWallet(){
  provider = null;
  signer = null;
  account = null;
  
  const btn = $('connectBtn');
  if(btn){
    btn.textContent = 'Connect Wallet';
    btn.classList.remove('connected');
  }
  
  hideWalletInfo();
  $('networkBadge').textContent = 'Réseau: —';
}

// Initialiser les interactions du sidebar
function initSidebarInteractions(){
  // Bouton de fermeture
  const closeBtn = $('closeSidebar');
  if(closeBtn){
    closeBtn.addEventListener('click', closeSidebar);
  }
  
  // Overlay pour fermer
  const overlay = $('sidebarOverlay');
  if(overlay){
    overlay.addEventListener('click', closeSidebar);
  }
  
  // Bouton de déconnexion
  const disconnectBtn = $('disconnectSidebarBtn');
  if(disconnectBtn){
    disconnectBtn.addEventListener('click', ()=>{
      disconnectWallet();
    });
  }
  
  // Bouton copier l'adresse
  const copyBtn = $('copyAddress');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      if(account){
        navigator.clipboard.writeText(account);
        copyBtn.textContent = '✓';
        copyBtn.style.color = '#39d98a';
        setTimeout(()=>{
          copyBtn.textContent = '📋';
          copyBtn.style.color = '';
        }, 2000);
      }
    });
  }
}

// ---------- Network Modal ----------
function openNetworkModal(){
  const modal = $('networkModal');
  const overlay = $('networkModalOverlay');
  if(modal) modal.classList.add('active');
  if(overlay) overlay.classList.add('active');
  updateActiveNetwork();
}

function closeNetworkModal(){
  const modal = $('networkModal');
  const overlay = $('networkModalOverlay');
  if(modal) modal.classList.remove('active');
  if(overlay) overlay.classList.remove('active');
}

function updateActiveNetwork(){
  if(!provider) return;
  
  provider.getNetwork().then(net => {
    const currentChainId = Number(net.chainId);
    document.querySelectorAll('.network-option').forEach(option => {
      const chainId = parseInt(option.dataset.chainId);
      if(chainId === currentChainId){
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
  });
}

async function signNetworkChange(chainId, networkName){
  try{
    const message = `BaseLearn - Changement de réseau

Vous allez basculer vers: ${networkName}
Chain ID: ${chainId}

Timestamp: ${new Date().toISOString()}
Nonce: ${Math.floor(Math.random() * 1e9)}`;

    // Demander la signature
    const messageHex = '0x' + Array.from(message).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [messageHex, account]
    });
    
    // Stocker la signature pour éviter de redemander
    const key = `network_switch_${account}_${chainId}`;
    sessionStorage.setItem(key, signature);
    
    return signature;
  }catch(e){
    console.warn('Signature annulée:', e);
    return null;
  }
}

async function switchNetwork(chainId){
  if(!window.ethereum || !account) return;
  
  const network = NETWORKS[chainId];
  if(!network) return;
  
  const hexChainId = '0x' + chainId.toString(16);
  
  // Vérifier si on a déjà signé pour ce changement
  const key = `network_switch_${account}_${chainId}`;
  const cachedSignature = sessionStorage.getItem(key);
  
  let signature = cachedSignature;
  
  // Si pas de signature en cache, en demander une
  if(!signature){
    // Afficher le loader de signature
    const signingLoader = $('signingLoader');
    const networkList = document.querySelector('.network-list');
    
    if(signingLoader) signingLoader.style.display = 'flex';
    if(networkList) networkList.style.display = 'none';
    
    try{
      signature = await signNetworkChange(chainId, network.name);
    }finally{
      // Masquer le loader
      if(signingLoader) signingLoader.style.display = 'none';
      if(networkList) networkList.style.display = 'flex';
    }
    
    // Si l'utilisateur a annulé la signature
    if(!signature){
      alert('Signature requise pour changer de réseau');
      return;
    }
  }
  
  try{
    // Essayer de changer le réseau
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }]
    });
    
    // Recharger le provider
    provider = new window.ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    
    // Mettre à jour l'affichage
    const net = await provider.getNetwork();
    const newChainId = Number(net.chainId);
    $('networkBadge').textContent = `Réseau: ${formatChain(newChainId)}`;
    
    // Fermer le modal
    closeNetworkModal();
    
    // Si connecté, mettre à jour les infos
    if(account){
      updateSidebarInfo();
    }
    
  } catch(error){
    // Si le réseau n'existe pas dans MetaMask, on l'ajoute
    if(error.code === 4902){
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexChainId,
          chainName: network.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [network.rpc],
          blockExplorerUrls: [network.explorer]
        }]
      });
      
      // Recharger après ajout
      location.reload();
    } else {
      alert('Erreur de changement de réseau: ' + error.message);
    }
  }
}

function initNetworkModal(){
  // Rendre le badge cliquable
  const badge = $('networkBadge');
  if(badge){
    badge.addEventListener('click', ()=>{
      if(!account){
        alert('Connectez d\'abord votre wallet');
        return;
      }
      openNetworkModal();
    });
  }
  
  // Bouton de fermeture
  const closeBtn = $('closeNetworkModal');
  if(closeBtn){
    closeBtn.addEventListener('click', closeNetworkModal);
  }
  
  // Overlay pour fermer
  const overlay = $('networkModalOverlay');
  if(overlay){
    overlay.addEventListener('click', closeNetworkModal);
  }
  
  // Sélection d'un réseau
  document.querySelectorAll('.network-option').forEach(option => {
    option.addEventListener('click', async ()=>{
      const chainId = parseInt(option.dataset.chainId);
      await switchNetwork(chainId);
    });
  });
}

// Initialiser après le chargement
window.addEventListener('load', ()=>{
  initWalletConnection();
  initSidebarInteractions();
  initNetworkModal();
});
