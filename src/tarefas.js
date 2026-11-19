// Tarefas periódicas (um processo só na VPS: setInterval basta).
//   - a cada 5 min: expira jogos agendados vencidos há 24 h (libera vaga);
//   - a cada hora: fim do teste, inadimplência prolongada, lembretes.
function iniciarTarefas({ repos, cobranca, log = console }) {
    async function expirarJogos() {
        try {
            const r = await repos.jogos.expirarVencidos();
            if (r.length) log.log(`Jogos expirados automaticamente: ${r.map(j => j.id).join(', ')}`);
        } catch (e) { log.error('Falha ao expirar jogos:', e.message); }
    }
    async function revisar() {
        try {
            const m = await cobranca.revisarStatus();
            if (m.length) log.log('Status de clientes revisados:', JSON.stringify(m));
        } catch (e) { log.error('Falha ao revisar status de clientes:', e.message); }
    }
    const t1 = setInterval(expirarJogos, 5 * 60 * 1000);
    const t2 = setInterval(revisar, 60 * 60 * 1000);
    t1.unref(); t2.unref();
    // Primeira rodada logo após subir.
    setTimeout(() => { expirarJogos(); revisar(); }, 5000).unref();
    return { parar() { clearInterval(t1); clearInterval(t2); }, expirarJogos, revisar };
}

module.exports = { iniciarTarefas };
