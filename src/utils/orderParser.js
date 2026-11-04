// Cache em memória por texto_bruto/id para evitar re-parse de JSON em listagens repetidas (economia de CPU)
const parseCache = new Map();

/**
 * Extrai itens reais (com quantidades, preços reais e opcionais), valores reais do pedido
 * e classificação detalhada da forma de pagamento para iFood, CardápioWeb, 99Food e comandas texto.
 */
function extrairItensEPagamentoPedido(origem, textoBruto, cacheId = null) {
  const rawStr = textoBruto ? String(textoBruto).trim() : '';
  const cacheKey = cacheId ? `${cacheId}_${rawStr.length}` : null;
  if (cacheKey && parseCache.has(cacheKey)) {
    return parseCache.get(cacheKey);
  }

  let itens = [];
  let subtotalReal = null;
  let totalPedidoReal = null;
  let descontoReal = 0;

  let pagamento = {
    metodo: 'NAO_INFORMADO', // 'CARTAO' | 'DINHEIRO' | 'PIX' | 'ONLINE' | 'NAO_INFORMADO'
    rotulo: 'Não informado',
    is_cartao_ou_dinheiro: false,
    troco_para: null,
    valor_cobrar: 0
  };

  if (rawStr.startsWith('{')) {
    try {
      const parsedRaw = JSON.parse(rawStr);
      const orderInfo99 = parsedRaw.data?.order_info || parsedRaw.data || null;
      const items99 = orderInfo99?.order_items || parsedRaw.order_items || null;

      // ── 1. FORMATO 99FOOD (valores em centavos) ─────────────────────────────
      if (Array.isArray(items99) && items99.length > 0) {
        itens = items99.map(it => {
          const qtd = Number(it.amount || it.quantity || 1);
          const totalCents = it.total_price !== undefined
            ? Number(it.total_price)
            : (Number(it.sku_price || 0) * qtd);
          const totalReais = totalCents / 100;
          const precoUnit = qtd > 0 ? (totalReais / qtd) : totalReais;

          const subList = Array.isArray(it.sub_item_list) ? it.sub_item_list : [];
          const optsStr = subList.map(sub => {
            const sQtd = Number(sub.amount || sub.quantity || 1);
            const sCents = sub.total_price !== undefined
              ? Number(sub.total_price)
              : (Number(sub.sku_price || 0) * sQtd);
            const sReais = sCents / 100;
            return `${sQtd > 1 ? sQtd + 'x ' : ''}${sub.name}${sReais > 0 ? ' (+R$ ' + sReais.toFixed(2).replace('.', ',') + ')' : ''}`;
          }).join(', ');

          const promoCents = Number(it.promotion_detail?.promo_discount || 0);
          const promoStr = promoCents > 0
            ? `Desconto promo: -R$ ${(promoCents / 100).toFixed(2).replace('.', ',')}`
            : '';

          const obsParts = [optsStr, it.remark || '', promoStr].map(s => String(s).trim()).filter(Boolean);
          return {
            nome: it.name || 'Item 99Food',
            qtd,
            preco: Number(precoUnit.toFixed(2)),
            obs: obsParts.join(' | ') || undefined
          };
        });
      }

      if (orderInfo99 && orderInfo99.price) {
        const p99 = orderInfo99.price;
        if (p99.order_price !== undefined) {
          subtotalReal = Number(p99.order_price) / 100;
        }
        const realPayCents = p99.real_pay_price ?? p99.customer_need_paying_money ?? p99.real_price ?? p99.order_price;
        if (realPayCents !== undefined) {
          totalPedidoReal = Number(realPayCents) / 100;
        }
        if (p99.items_discount) {
          descontoReal = Number(p99.items_discount) / 100;
        }
      }

      if (orderInfo99 && (orderInfo99.pay_type !== undefined || orderInfo99.pay_method !== undefined)) {
        const payType = Number(orderInfo99.pay_type);
        const payMethod = Number(orderInfo99.pay_method);
        const payChannel = Number(orderInfo99.pay_channel);
        const valorCobrar99 = totalPedidoReal || 0;

        // Na 99Food: pay_type === 2 ou pay_method === 2 indica pagamento na entrega (Offline: Cartão ou Dinheiro)
        if (payType === 2 || payMethod === 2) {
          if (payChannel === 153) {
            pagamento = {
              metodo: 'DINHEIRO',
              rotulo: 'Dinheiro (Entrega)',
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valorCobrar99
            };
          } else if (payChannel === 262) {
            pagamento = {
              metodo: 'CARTAO',
              rotulo: 'Cartão de Crédito (Entrega)',
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valorCobrar99
            };
          } else if (payChannel === 263) {
            pagamento = {
              metodo: 'CARTAO',
              rotulo: 'Cartão de Débito (Entrega)',
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valorCobrar99
            };
          } else {
            pagamento = {
              metodo: 'CARTAO',
              rotulo: 'Cartão / Dinheiro (Entrega)',
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valorCobrar99
            };
          }
        } else {
          pagamento = {
            metodo: 'ONLINE',
            rotulo: payChannel === 212 ? 'Pago Online (Pix 99Food)' : 'Pago Online (99Food)',
            is_cartao_ou_dinheiro: false,
            troco_para: null,
            valor_cobrar: valorCobrar99
          };
        }
      }

      // ── 2. FORMATO IFOOD & CARDÁPIOWEB (parsedRaw.items em Reais) ───────────
      if (itens.length === 0) {
        const rawItems = parsedRaw.items || parsedRaw.data?.order_info?.products || [];
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          itens = rawItems.map(it => {
            const qtd = Number(it.quantity || it.amount || 1);
            const totalItem = (it.total_price !== undefined || it.totalPrice !== undefined)
              ? Number(it.total_price ?? it.totalPrice)
              : (Number(it.unit_price ?? it.unitPrice ?? it.price ?? 0) * qtd);
            const precoUnit = qtd > 0 ? (totalItem / qtd) : totalItem;

            const opts = Array.isArray(it.options) && it.options.length > 0
              ? it.options.map(o => {
                  const oQtd = Number(o.quantity || 1);
                  const oPrice = Number(o.price ?? ((o.unit_price ?? o.unitPrice ?? 0) * oQtd));
                  return `${oQtd > 1 ? oQtd + 'x ' : ''}${o.name}${oPrice > 0 ? ' (+R$ ' + oPrice.toFixed(2).replace('.', ',') + ')' : ''}`;
                }).join(', ')
              : '';
            const obsParts = [opts, it.observation || it.observations || ''].map(s => String(s).trim()).filter(Boolean);
            return {
              nome: it.name || it.item_name || 'Item',
              qtd,
              preco: Number(precoUnit.toFixed(2)),
              obs: obsParts.join(' | ') || undefined
            };
          });
        }
      }

      // Totais e Pagamento CardápioWeb (parsedRaw.payments é Array)
      if (Array.isArray(parsedRaw.payments)) {
        if (parsedRaw.total !== undefined && !isNaN(Number(parsedRaw.total))) {
          totalPedidoReal = Number(parsedRaw.total);
        }
        if (parsedRaw.payments.length > 0) {
          const p0 = parsedRaw.payments[0];
          const pm = String(p0.payment_method || '').toLowerCase();
          const pType = String(p0.payment_type || '').toLowerCase();
          const valTotal = totalPedidoReal ?? Number(p0.total || 0);
          const changeFor = p0.change_for ? Number(p0.change_for) : null;

          if (pm === 'money' || pm === 'cash' || pm === 'dinheiro') {
            pagamento = {
              metodo: 'DINHEIRO',
              rotulo: changeFor ? `Dinheiro (Troco p/ R$ ${changeFor.toFixed(2).replace('.', ',')})` : 'Dinheiro',
              is_cartao_ou_dinheiro: true,
              troco_para: changeFor,
              valor_cobrar: valTotal
            };
          } else if (pm === 'credit_card' || pm === 'debit_card' || pm === 'meal_voucher' || pm === 'food_voucher' || pm.includes('card') || pm.includes('cartao')) {
            const tipoCartao = pm === 'debit_card'
              ? 'Cartão de Débito'
              : (pm === 'credit_card' ? 'Cartão de Crédito' : (pm === 'meal_voucher' ? 'Vale-Refeição' : 'Cartão'));
            pagamento = {
              metodo: 'CARTAO',
              rotulo: `${tipoCartao}${p0.card_brand ? ' (' + p0.card_brand + ')' : ''}`,
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valTotal
            };
          } else if (pm.includes('pix')) {
            pagamento = {
              metodo: 'PIX',
              rotulo: (pType === 'online' || pm === 'pix_auto') ? 'Pix Online (Pago)' : 'Pix',
              is_cartao_ou_dinheiro: false,
              troco_para: null,
              valor_cobrar: valTotal
            };
          }
        }
      }
      // Totais e Pagamento iFood (parsedRaw.payments.methods é Array)
      else if (parsedRaw.payments && Array.isArray(parsedRaw.payments.methods)) {
        if (parsedRaw.total && typeof parsedRaw.total === 'object') {
          if (parsedRaw.total.subTotal !== undefined) subtotalReal = Number(parsedRaw.total.subTotal);
          if (parsedRaw.total.orderAmount !== undefined) totalPedidoReal = Number(parsedRaw.total.orderAmount);
          if (parsedRaw.total.benefits !== undefined) descontoReal = Number(parsedRaw.total.benefits);
        }

        if (parsedRaw.payments.methods.length > 0) {
          const methods = parsedRaw.payments.methods;
          const offlineMethod = methods.find(m => String(m.type || '').toUpperCase() === 'OFFLINE' || m.prepaid === false);
          const m = offlineMethod || methods[0];
          const mType = String(m.type || '').toUpperCase();
          const mMethod = String(m.method || '').toUpperCase();
          const isOffline = (mType === 'OFFLINE' || m.prepaid === false || Number(parsedRaw.payments.pending || 0) > 0);
          const valTotal = Number(parsedRaw.payments.pending || totalPedidoReal || m.value || 0);
          const changeFor = m.cash?.changeFor ? Number(m.cash.changeFor) : null;
          const brand = m.card?.brand ? ` (${m.card.brand})` : '';

          if (isOffline && (mMethod === 'CASH' || mMethod === 'DINHEIRO')) {
            pagamento = {
              metodo: 'DINHEIRO',
              rotulo: changeFor ? `Dinheiro (Troco p/ R$ ${changeFor.toFixed(2).replace('.', ',')})` : 'Dinheiro (Entrega)',
              is_cartao_ou_dinheiro: true,
              troco_para: changeFor,
              valor_cobrar: valTotal
            };
          } else if (isOffline && (mMethod === 'CREDIT' || mMethod === 'DEBIT' || mMethod === 'MEAL_VOUCHER' || mMethod === 'FOOD_VOUCHER' || mMethod === 'CARD')) {
            const nomeCartao = mMethod === 'DEBIT' ? 'Cartão de Débito' : (mMethod === 'CREDIT' ? 'Cartão de Crédito' : 'Cartão / Vale');
            pagamento = {
              metodo: 'CARTAO',
              rotulo: `${nomeCartao}${brand} (Entrega)`,
              is_cartao_ou_dinheiro: true,
              troco_para: null,
              valor_cobrar: valTotal
            };
          } else {
            pagamento = {
              metodo: 'ONLINE',
              rotulo: mMethod === 'PIX' ? 'Pago Online (Pix iFood)' : `Pago Online (iFood${brand})`,
              is_cartao_ou_dinheiro: false,
              troco_para: null,
              valor_cobrar: Number(totalPedidoReal || m.value || 0)
            };
          }
        }
      }
    } catch (e) {}
  } else if (rawStr) {
    // ── 3. COMANDAS EM TEXTO PLANO (Spooler legado ou Pedido Manual) ──────────
    const lines = rawStr.split(/\r?\n/);
    lines.forEach(l => {
      const trimmed = l.trim();
      if (!trimmed) return;
      const matchItemPreco = trimmed.match(/^(\d+)\s*x?\s+(.+?)\s+R\$\s*(\d+[.,]\d{2})$/i);
      if (matchItemPreco) {
        const qtd = Number(matchItemPreco[1]) || 1;
        const nome = matchItemPreco[2].trim();
        const totalLinha = parseFloat(matchItemPreco[3].replace(',', '.')) || 0;
        itens.push({
          nome,
          qtd,
          preco: Number((totalLinha / qtd).toFixed(2))
        });
      } else if (trimmed.match(/^\d+x\s+/i) || (trimmed.startsWith('- ') && itens.length === 0)) {
        const matchQtd = trimmed.match(/^(\d+)x\s+(.+)/i);
        itens.push({
          nome: matchQtd ? matchQtd[2].trim() : trimmed.replace(/^-+\s*/, ''),
          qtd: matchQtd ? Number(matchQtd[1]) : 1,
          preco: 0.0
        });
      }
    });

    const matchTotalTexto = rawStr.match(/(?:Valor total do pedido|Total)\s*:?\s*R\$\s*(\d+[.,]\d{2})/i);
    if (matchTotalTexto) {
      totalPedidoReal = parseFloat(matchTotalTexto[1].replace(',', '.')) || null;
    }

    const upper = rawStr.toUpperCase();
    const isPagoOnlineTexto = upper.includes('PAGAMENTO REALIZADO') || upper.includes('ONLINE - PIX') || /COBRAR DO CLIENTE:\s*R\$\s*0[.,]00/i.test(rawStr);
    if (isPagoOnlineTexto) {
      pagamento = { metodo: 'ONLINE', rotulo: 'Pago Online', is_cartao_ou_dinheiro: false, troco_para: null, valor_cobrar: totalPedidoReal || 0 };
    } else if (/\b(?:DINHEIRO|ESP[EÉ]CIE|TROCO\s+PARA|TROCO\s+P\/)\b/i.test(rawStr)) {
      pagamento = { metodo: 'DINHEIRO', rotulo: 'Dinheiro', is_cartao_ou_dinheiro: true, troco_para: null, valor_cobrar: totalPedidoReal || 0 };
    } else if (/\b(?:CART[AÃ]O|CR[EÉ]DITO|D[EÉ]BITO|MAQUININHA)\b/i.test(rawStr) && !upper.includes('ONLINE')) {
      pagamento = { metodo: 'CARTAO', rotulo: 'Cartão', is_cartao_ou_dinheiro: true, troco_para: null, valor_cobrar: totalPedidoReal || 0 };
    } else if (/\bPIX\b/i.test(rawStr)) {
      pagamento = { metodo: 'PIX', rotulo: 'Pix', is_cartao_ou_dinheiro: false, troco_para: null, valor_cobrar: totalPedidoReal || 0 };
    }
  }

  const result = {
    itens,
    subtotal_real: subtotalReal,
    total_pedido_real: totalPedidoReal,
    desconto_real: descontoReal,
    pagamento
  };

  if (cacheKey) {
    if (parseCache.size > 1000) parseCache.clear();
    parseCache.set(cacheKey, result);
  }

  return result;
}

module.exports = { extrairItensEPagamentoPedido };
