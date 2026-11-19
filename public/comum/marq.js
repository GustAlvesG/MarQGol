// Utilitários comuns do MarQGol no navegador (sem dependências):
//
//   MARQ.placarId                  → id do placar pela URL (/p/<id>/...) ou null
//   MARQ.conectar({ telaSoLeitura }) → socket.io do placar atual; sem acesso,
//                                    leva ao login (pessoa) ou ao pareamento (TV)
//   MARQ.api(metodo, url, corpo)   → fetch JSON com o cabeçalho X-MarQ; lança
//                                    Error com a mensagem do servidor (.status, .codigo)
//   MARQ.enviarArquivo(url, arquivo, aoProgresso) → POST do arquivo cru
//   MARQ.enviarArquivoPut(url, arquivo)           → PUT do arquivo cru (arte)
//   MARQ.dinheiro(centavos), MARQ.data(iso), MARQ.dataHora(iso)
(function () {
    const m = location.pathname.match(/^\/p\/(\d+)(\/|$)/);
    const placarId = m ? Number(m[1]) : null;
    const voltarParaAqui = () => '/entrar?voltar=' + encodeURIComponent(location.pathname + location.search + location.hash);

    async function api(metodo, url, corpo) {
        const opcoes = { method: metodo, headers: { 'X-MarQ': '1' }, credentials: 'same-origin' };
        if (corpo !== undefined) {
            opcoes.headers['Content-Type'] = 'application/json';
            opcoes.body = JSON.stringify(corpo);
        }
        const resp = await fetch(url, opcoes);
        let dado = null;
        try { dado = await resp.json(); } catch { dado = null; }
        if (!resp.ok) {
            const erro = new Error((dado && dado.erro) || `Erro ${resp.status}`);
            erro.status = resp.status;
            erro.codigo = dado && dado.codigo;
            if (resp.status === 401 && !url.startsWith('/api/auth/')) location.href = voltarParaAqui();
            throw erro;
        }
        return dado;
    }

    // Upload com progresso (XHR: fetch não informa progresso de envio).
    function enviarCru(metodo, url, arquivo, aoProgresso) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(metodo, url);
            xhr.setRequestHeader('X-MarQ', '1');
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            if (aoProgresso) xhr.upload.onprogress = (e) => e.lengthComputable && aoProgresso(e.loaded / e.total);
            xhr.onload = () => {
                let dado = null;
                try { dado = JSON.parse(xhr.responseText); } catch { /* corpo vazio */ }
                if (xhr.status >= 200 && xhr.status < 300) resolve(dado);
                else reject(Object.assign(new Error((dado && dado.erro) || `Erro ${xhr.status}`), { status: xhr.status }));
            };
            xhr.onerror = () => reject(new Error('Falha de rede no envio.'));
            xhr.send(arquivo);
        });
    }

    // Faixa de "sem conexão": se a internet do ginásio cair, o telão congela
    // no último estado — o operador precisa saber na hora.
    function criarFaixa() {
        const faixa = document.createElement('div');
        faixa.setAttribute('role', 'status');
        faixa.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;background:#f04444;color:#fff;font:700 15px system-ui,sans-serif;padding:8px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:none;display:none';
        faixa.textContent = 'Sem conexão com o servidor — reconectando…';
        const pendurar = () => document.body.appendChild(faixa);
        if (document.body) pendurar(); else document.addEventListener('DOMContentLoaded', pendurar);
        return faixa;
    }

    // `telaSoLeitura`: página de TV (telão, placares paralelos) — sem acesso,
    // vai para o pareamento em vez do login.
    function conectar({ telaSoLeitura = false } = {}) {
        const socket = io({ query: { placar: placarId } });
        socket.on('connect_error', (erro) => {
            const motivo = erro && erro.message;
            if (motivo === 'nao_autenticado') {
                location.href = telaSoLeitura ? '/telao' : voltarParaAqui();
            } else if (motivo === 'sem_acesso' || motivo === 'placar_inexistente') {
                location.href = telaSoLeitura ? '/telao' : '/app/';
            } else if ((motivo === 'placar_inativo' || motivo === 'placar_excedente') && !telaSoLeitura) {
                socket.disconnect();
                const texto = motivo === 'placar_inativo'
                    ? 'Este placar está desativado. Ative-o em Placares, na área do cliente.'
                    : 'Seu plano permite menos placares do que os que estão ativos. Desative um placar ou troque de plano.';
                if (window.avisar) window.avisar('Placar indisponível', texto).then(() => { location.href = '/app/#placares'; });
                else { alert(texto); location.href = '/app/#placares'; }
            }
        });
        let faixa = null;
        let caiuEm = null;
        socket.on('disconnect', () => {
            caiuEm = Date.now();
            // No telão, quedas rápidas não aparecem para o público.
            setTimeout(() => {
                if (caiuEm && !socket.connected) { faixa = faixa || criarFaixa(); faixa.style.display = 'block'; }
            }, telaSoLeitura ? 5000 : 1500);
        });
        socket.on('connect', () => { caiuEm = null; if (faixa) faixa.style.display = 'none'; });
        return socket;
    }

    const fmtDinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    window.MARQ = {
        placarId,
        api,
        enviarArquivo: (url, arquivo, aoProgresso) => enviarCru('POST', url, arquivo, aoProgresso),
        enviarArquivoPut: (url, arquivo, aoProgresso) => enviarCru('PUT', url, arquivo, aoProgresso),
        conectar,
        dinheiro: (centavos) => fmtDinheiro.format((Number(centavos) || 0) / 100),
        data: (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—',
        dataHora: (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
    };
})();
